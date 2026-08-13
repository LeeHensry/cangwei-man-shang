/**
 * Deribit API 接入层
 * 文档: https://docs.deribit.com/
 * 支持: BTC/ETH 期权行情、交易
 */

const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://www.deribit.com';
const WS_URL = 'wss://www.deribit.com/ws/api/v2';

class DeribitClient {
  constructor(apiKey = null, apiSecret = null) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  /**
   * 公开API调用
   */
  async publicGet(method, params = {}) {
    try {
      const url = `${BASE_URL}/api/v2/public/${method}`;
      const resp = await axios.get(url, { params, timeout: 15000 });
      return resp.data.result;
    } catch (err) {
      console.error(`Deribit public ${method} error:`, err.message);
      throw err;
    }
  }

  /**
   * 获取BTC或ETH的标的价格指数
   * @param {string} currency - 'BTC' | 'ETH'
   */
  async getIndexPrice(currency = 'BTC') {
    const indexName = currency.toUpperCase() === 'ETH' ? 'eth_usd' : 'btc_usd';
    const r = await this.publicGet('get_index_price', { index_name: indexName });
    return r.index_price;
  }

  /**
   * 获取期权合约的结算价格（BTC用BTC-USD指数，ETH用ETH-USD指数）
   */
  async getInstruments(currency = 'BTC', kind = 'option', expired = false) {
    return this.publicGet('get_instruments', {
      currency: currency.toUpperCase(),
      kind,
      expired
    });
  }

  /**
   * 获取期权链 - 某个到期日的所有期权报价
   * @param {string} instrumentName - 如 'BTC-27DEC24-100000-C' 用到期日前缀查，如 'BTC-27DEC24'
   */
  async getOptionBook(instrumentName, depth = 5) {
    return this.publicGet('get_order_book', {
      instrument_name: instrumentName,
      depth
    });
  }

  /**
   * 获取期权链摘要（所有到期日的期权链）
   * @param {string} currency - 'BTC' | 'ETH'
   */
  async getOptionChain(currency = 'BTC') {
    // 获取所有活跃期权合约
    const instruments = await this.getInstruments(currency, 'option', false);

    // 按到期日分组
    const byExpiry = {};
    for (const inst of instruments) {
      const exp = inst.expiration_timestamp;
      if (!byExpiry[exp]) byExpiry[exp] = [];
      byExpiry[exp].push(inst);
    }

    // 获取当前指数价格
    const indexPrice = await this.getIndexPrice(currency);

    return {
      currency,
      indexPrice,
      expiries: Object.keys(byExpiry).map(ts => ({
        expiryTimestamp: parseInt(ts),
        expiryDate: new Date(parseInt(ts)).toISOString(),
        instruments: byExpiry[ts].sort((a, b) => a.strike - b.strike)
      })).sort((a, b) => a.expiryTimestamp - b.expiryTimestamp)
    };
  }

  /**
   * 获取期权链报价摘要（含bid/ask/IV，greeks由本地BS模型计算）
   * 用get_book_summary_by_currency一次获取所有期权，避免几百次串行请求
   * @param {string} currency - 'BTC' | 'ETH'
   * @param {number|null} expiryTimestamp - 到期日时间戳，不传则取最近N个
   * @param {number} maxExpiries - 最多返回多少个到期日（默认3）
   */
  async getOptionChainSummary(currency = 'BTC', expiryTimestamp = null, maxExpiries = 3) {
    const cur = currency.toUpperCase();
    const [instruments, bookSummary, indexPrice] = await Promise.all([
      this.getInstruments(cur, 'option', false),
      this.publicGet('get_book_summary_by_currency', { currency: cur, kind: 'option' }),
      this.getIndexPrice(cur)
    ]);

    // bookSummary用instrument_name做索引
    const bookMap = {};
    for (const b of bookSummary) {
      bookMap[b.instrument_name] = b;
    }

    // 按到期日分组
    const byExpiry = {};
    for (const inst of instruments) {
      if (!inst.is_active) continue;
      const exp = inst.expiration_timestamp;
      if (!byExpiry[exp]) byExpiry[exp] = [];
      const book = bookMap[inst.instrument_name] || {};
      byExpiry[exp].push({
        instrument: inst.instrument_name,
        strike: inst.strike,
        type: inst.option_type,
        expiry: exp,
        creationTs: inst.creation_timestamp,
        bidPrice: book.bid_price,
        askPrice: book.ask_price,
        markPrice: book.mark_price,
        markIv: book.mark_iv ? (book.mark_iv > 1 ? book.mark_iv / 100 : book.mark_iv) : 0.6, // 兼容：Deribit返回百分比(如65=65%)或小数(如0.66)，统一转小数
        underlyingPrice: book.underlying_price || indexPrice,
        volume: book.volume || 0,
        openInterest: book.open_interest || 0,
        priceIndex: inst.price_index
      });
    }

    // 排序并选择到期日
    let expiries = Object.keys(byExpiry).map(Number).sort((a, b) => a - b);
    if (expiryTimestamp) {
      expiries = expiries.filter(e => e === expiryTimestamp);
    } else {
      // 默认取最近N个未到期
      const now = Date.now();
      expiries = expiries.filter(e => e > now).slice(0, maxExpiries);
    }

    const chains = expiries.map(exp => {
      const options = byExpiry[exp].sort((a, b) => a.strike - b.strike);
      return {
        expiryTimestamp: exp,
        expiryDate: new Date(exp).toISOString().split('T')[0],
        daysToExpiry: Math.max(0, Math.ceil((exp - Date.now()) / (24 * 3600 * 1000))),
        options
      };
    });

    return { currency: cur, indexPrice, chains };
  }

  /**
   * 认证（私有API需要）
   */
  async auth() {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('API key and secret required for authenticated requests');
    }
    try {
      const resp = await axios.get(`${BASE_URL}/api/v2/public/auth`, {
        params: {
          grant_type: 'client_credentials',
          client_id: this.apiKey,
          client_secret: this.apiSecret
        },
        timeout: 15000
      });
      this.accessToken = resp.data.result.access_token;
      this.tokenExpiry = Date.now() + resp.data.result.expires_in * 1000;
      return this.accessToken;
    } catch (err) {
      console.error('Deribit auth error:', err.message);
      throw err;
    }
  }

  /**
   * 下单（私有API）
   * @param {Object} params - {instrument_name, amount, type, direction, label, price?, post_only?}
   * 注意：Deribit期权的amount单位是合约数量(1合约=1 BTC/ETH)，但以BTC/ETH计价
   */
  async placeOrder(params) {
    const token = await this.auth();
    const resp = await axios.get(`${BASE_URL}/api/v2/private/buy`, {
      params: { ...params },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });
    return resp.data.result;
  }

  async sellOrder(params) {
    const token = await this.auth();
    const resp = await axios.get(`${BASE_URL}/api/v2/private/sell`, {
      params: { ...params },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });
    return resp.data.result;
  }

  /**
   * 获取账户余额
   */
  async getAccountSummary(currency = 'BTC') {
    const token = await this.auth();
    return this.publicGet('get_account_summary', {
      currency: currency.toUpperCase()
    }).then(async (r) => {
      // publicGet doesn't have auth, use direct call
      const resp = await axios.get(`${BASE_URL}/api/v2/private/get_account_summary`, {
        params: { currency: currency.toUpperCase() },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      });
      return resp.data.result;
    });
  }

  /**
   * 获取持仓
   */
  async getPositions(currency = 'BTC', kind = 'option') {
    const token = await this.auth();
    const resp = await axios.get(`${BASE_URL}/api/v2/private/get_positions`, {
      params: { currency: currency.toUpperCase(), kind },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });
    return resp.data.result;
  }
}

// 默认公开实例（无需API key）
const publicClient = new DeribitClient();

module.exports = { DeribitClient, publicClient };
