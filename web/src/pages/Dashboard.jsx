import React, { useState, useEffect } from 'react';
import { Row, Col, Table, Tag, Progress, Space, Button, Tooltip, Spin, Divider } from 'antd';
import {
  ReloadOutlined, FireOutlined, InfoCircleOutlined,
  FundViewOutlined, WarningOutlined, RocketOutlined,
  ArrowUpOutlined, ArrowDownOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { getOverview, triggerSync } from '../api';

const signalMeta = {
  buy:          { label:'买入',  color:'#EF4444' },
  watch:        { label:'关注',  color:'#F97316' },
  hold:         { label:'持有',  color:'#3B82F6' },
  sell:         { label:'减仓',  color:'#22C55E' },
  momentum_buy: { label:'动量',  color:'#A855F7' },
};

/* ---------- 指数小卡 ---------- */
function IndexCard({ item }) {
  const isUp = item.pct_chg >= 0;
  return (
    <div className="card" style={{ height:'100%', padding:'16px 20px' }}>
      <div style={{
        fontSize:11, color:'#94A3B8', fontWeight:500,
        letterSpacing:'0.08em', marginBottom:10,
        fontFamily:"'JetBrains Mono',monospace", textTransform:'uppercase',
      }}>{item.name}</div>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between'}}>
        <span className="num-md" style={{fontSize:21}}>
          {item.close?.toFixed(item.close > 1000 ? 0 : item.close > 100 ? 1 : 2)}
        </span>
        <span className={'pct-chip '+(isUp?'pct-up':'pct-down')}>
          {isUp ? <ArrowUpOutlined style={{fontSize:9}}/> : <ArrowDownOutlined style={{fontSize:9}}/>}
          {isUp?'+':''}{item.pct_chg?.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

/* ---------- 四维评分小条 ---------- */
function DimBar({ label, score, color='#0052FF' }) {
  return (
    <div style={{textAlign:'center',flex:1}}>
      <div className="num-sm" style={{fontSize:15,fontWeight:500,color:'#0F172A'}}>{score}</div>
      <div style={{
        fontSize:10,color:'#94A3B8',fontWeight:500,
        textTransform:'uppercase',letterSpacing:'0.04em',
        marginTop:3,marginBottom:6,fontFamily:"'Inter',sans-serif",
      }}>{label}</div>
      <div className="bar-track">
        <div className="bar-fill" style={{width:Math.min(score,100)+'%',background:color}}/>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try { setData(await getOverview()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try { await triggerSync(); } catch(e) {}
    setTimeout(load, 3000);
    setTimeout(() => setSyncing(false), 6000);
  };

  if (loading) {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'60vh',flexDirection:'column',gap:14}}>
        <Spin size="large"/>
        <div style={{color:'#94A3B8',fontSize:13,fontWeight:400}}>加载市场数据...</div>
      </div>
    );
  }
  if (!data) return null;

  const t = data.temperature;
  const amountWanYi = (t.total_amount / 10000).toFixed(2);

  /* ---- ECharts text color tokens ---- */
  const chartText = '#64748B';
  const chartAxis = '#E2E8F0';
  const tooltipBg = 'rgba(15,23,42,0.96)';
  const tooltipBorder = 'transparent';

  /* ---- 温度计 gauge ---- */
  const tempColor = t.color === '#E53935' ? '#EF4444'
    : t.color === '#F57C00' ? '#F97316'
    : t.color === '#FBC02D' ? '#FBBF24'
    : t.color === '#43A047' ? '#22C55E'
    : '#F59E0B';

  const tempOption = {
    backgroundColor:'transparent',
    series:[{
      type:'gauge', startAngle:220, endAngle:-40, min:0, max:100,
      radius:'92%', center:['50%','58%'],
      progress:{ show:true, width:9, roundCap:true, itemStyle:{color:{type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:'#0052FF'},{offset:1,color:'#4D7CFF'}]}} },
      axisLine:{ lineStyle:{width:9, color:[
        [0.2,'#22C55E'],[0.4,'#4ADE80'],[0.55,'#FBBF24'],
        [0.75,'#F97316'],[0.9,'#EF4444'],[1,'#B91C1C'],
      ]}},
      pointer:{ length:'42%', width:3, itemStyle:{color:'#0F172A'} },
      anchor:{ show:true, size:10, itemStyle:{color:'#fff',borderColor:'#0F172A',borderWidth:2} },
      axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false}, title:{show:false},
      detail:{
        valueAnimation:true, fontSize:34, fontWeight:600,
        offsetCenter:[0,'-5%'], formatter:v=>v+'°',
        color:tempColor, fontFamily:"'Calistoga',Georgia,serif",
      },
      data:[{value:t.value}],
    }],
  };

  /* ---- 行业涨跌 bar ---- */
  const sectors = [...(data.sectors||[])].sort((a,b) => (a.change_pct||0) - (b.change_pct||0));
  const sectorOption = {
    backgroundColor:'transparent',
    grid:{ left:72, right:50, top:4, bottom:4 },
    xAxis:{ type:'value', show:false, axisLine:{show:false}, splitLine:{show:false} },
    yAxis:{
      type:'category', data:sectors.map(s=>s.sector_name),
      axisLine:{show:false}, axisTick:{show:false},
      axisLabel:{fontSize:12, color:chartText, fontWeight:400},
      splitLine:{show:false},
    },
    tooltip:{
      trigger:'axis', backgroundColor:tooltipBg, borderColor:tooltipBorder,
      textStyle:{color:'#fff',fontSize:12,fontWeight:400},
      extraCssText:'border-radius:10px;padding:10px 14px;box-shadow:0 10px 25px rgba(0,0,0,0.15);',
    },
    series:[{
      type:'bar', barWidth:11,
      data: sectors.map(s => ({
        value:+(s.change_pct||0).toFixed(2),
        itemStyle:{
          color: (s.change_pct||0) >= 0
            ? {type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:'rgba(239,68,68,0.06)'},{offset:1,color:'#EF4444'}]}
            : {type:'linear',x:1,y:0,x2:0,y2:0,colorStops:[{offset:0,color:'rgba(34,197,94,0.06)'},{offset:1,color:'#22C55E'}]},
          borderRadius: (s.change_pct||0)>=0 ? [0,5,5,0] : [5,0,0,5],
        }
      })),
      label:{
        show:true, position:'right',
        formatter:p=>p.value+'%', fontSize:11, color:chartText,
        fontWeight:400, fontFamily:"'JetBrains Mono',monospace",
      },
    }],
  };

  /* ---- 信号分布 doughnut ---- */
  const signalKeys = ['buy','momentum_buy','watch','hold','sell'];
  const signalTotal = data.total_stocks || 1;
  const signalOption = {
    backgroundColor:'transparent',
    tooltip:{
      trigger:'item', backgroundColor:tooltipBg, borderColor:tooltipBorder,
      textStyle:{color:'#fff',fontSize:12,fontWeight:400},
      extraCssText:'border-radius:8px;padding:8px 12px;',
      formatter:p=>p.name+'<br/>'+p.value+'只 · '+p.percent+'%',
    },
    series:[{
      type:'pie', radius:['55%','77%'], center:['36%','50%'], padAngle:2,
      itemStyle:{ borderRadius:5, borderColor:'#fff', borderWidth:3 },
      label:{show:false}, labelLine:{show:false},
      data: signalKeys.map(k => ({
        name:signalMeta[k].label,
        value:data.signal_counts[k]||0,
        itemStyle:{color:signalMeta[k].color},
      })),
    }],
  };

  const pctColor = v => v == null ? '#71717A' : v >= 0 ? '#EF4444' : '#22C55E';
  const formatPct = v => v == null ? '—' : (v>=0?'+':'')+v.toFixed(2)+'%';
  const buyCount = (data.signal_counts.buy||0)+(data.signal_counts.momentum_buy||0);
  const sellCount = data.signal_counts.sell||0;

  /* ---- TOP 表格列 ---- */
  const topCols = [
    { title:'#', width:36, align:'center', render:(_,__,i) => {
      const c = i<3 ? ['#EF4444','#F97316','#F59E0B'][i] : '#CBD5E1';
      return (
        <span style={{
          width:22,height:22,borderRadius:6,display:'inline-flex',
          alignItems:'center',justifyContent:'center',
          fontSize:11, fontWeight:500,
          background:i<3 ? (i===0?'rgba(239,68,68,0.08)':i===1?'rgba(249,115,22,0.08)':'rgba(245,158,11,0.08)') : '#F1F5F9', color:c,
          fontFamily:"'JetBrains Mono',monospace",
        }}>{i+1}</span>
      );
    }},
    { title:'股票', dataIndex:'name', render:(v,r) => (
      <div>
        <a onClick={()=>navigate('/stock/'+r.code)} style={{fontSize:13,fontWeight:500,color:'#0F172A'}}>{v}</a>
        <div className="font-mono" style={{fontSize:11,color:'#94A3B8',marginTop:1,fontFamily:"'JetBrains Mono',monospace"}}>
          {r.code}
        </div>
      </div>
    )},
    { title:'现价', dataIndex:'close', align:'right', width:70,
      render:(v,r) => (
        <span className="num-sm" style={{color:pctColor(r.pct_chg)}}>{v?.toFixed(2)}</span>
      )
    },
    { title:'今日', dataIndex:'pct_chg', align:'right', width:70,
      render:v => <span className="num-sm" style={{color:pctColor(v),fontWeight:500}}>{formatPct(v)}</span>,
      sorter:(a,b)=>(a.pct_chg||0)-(b.pct_chg||0),
    },
    { title:'7日', dataIndex:'pct_7d', align:'right', width:68,
      render:v => <span className="num-sm" style={{color:pctColor(v)}}>{formatPct(v)}</span>,
      sorter:(a,b)=>(a.pct_7d||0)-(b.pct_7d||0),
    },
    { title:'PE', dataIndex:'pe', align:'right', width:52,
      render:v => <span className="num-sm" style={{color:'#94A3B8'}}>{v?.toFixed(1)}x</span>
    },
    { title:'综合分', dataIndex:'total_score', width:136, align:'center',
      sorter:(a,b)=>a.total_score-b.total_score, defaultSortOrder:'descend',
      render:v => {
        const barColor = v>=75?'#EF4444':v>=65?'#F97316':'#60A5FA';
        return (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <Progress
              percent={v} size="small" showInfo={false}
              strokeColor={{'0%':'#0052FF','100%':'#4D7CFF'}} trailColor="#F1F5F9"
              style={{flex:1}} strokeWidth={4}
            />
            <span className="num-sm" style={{fontSize:13,fontWeight:500,color:'#0F172A',minWidth:22,textAlign:'right'}}>{v}</span>
          </div>
        );
      }
    },
    { title:'分项', align:'center', width:76, render:(_,r) => (
      <Space size={3} split={<span style={{color:'#333'}}>·</span>}>
        <Tooltip title="质量分"><span className="num-sm" style={{color:'#22C55E',fontWeight:500}}>{r.quality}</span></Tooltip>
        <Tooltip title="估值分"><span className="num-sm" style={{color:'#EF4444',fontWeight:500}}>{r.valuation}</span></Tooltip>
        <Tooltip title="技术分"><span className="num-sm" style={{color:'#3B82F6',fontWeight:500}}>{r.technical}</span></Tooltip>
      </Space>
    )},
    { title:'信号', dataIndex:'signal', width:66, align:'center',
      render:s => {
        const m = signalMeta[s];
        return <span className={'badge '+(s==='buy'?'badge-buy':s==='watch'?'badge-watch':s==='sell'?'badge-sell':s==='momentum_buy'?'badge-momentum':'badge-hold')}>{m?.label}</span>;
      }
    },
  ];

  return (
    <div>
      {/* 页头 */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:24}}>
        <div>
          <div className="eyebrow">Market Dashboard</div>
          <h1 className="page-title" style={{marginBottom:4}}>今日市场</h1>
          <div className="page-subtitle">
            {data.date} · 覆盖 <span style={{color:'#334155'}}>{data.total_stocks}</span> 只股票 · 成交额 <span style={{color:'#334155'}}>{amountWanYi} 万亿</span>
          </div>
        </div>
        <Button
          type="primary"
          icon={<ReloadOutlined spin={syncing}/>}
          onClick={handleSync}
          loading={syncing}
          size="large"
        >
          {syncing?'同步中...':'刷新数据'}
        </Button>
      </div>

      {/* 预警横幅 */}
      {(data.crowding?.stock_warnings?.length>0 || data.crowding?.momentum_candidates?.length>0) && (
        <Row gutter={[12,12]} style={{marginBottom:14}}>
          {data.crowding.stock_warnings?.length>0 && (
            <Col span={data.crowding.momentum_candidates?.length>0?12:24}>
              <div className="card" style={{borderLeft:'3px solid #EF4444',padding:'16px 20px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <Space size={8}>
                    <WarningOutlined style={{color:'#EF4444',fontSize:14}}/>
                    <span style={{fontSize:13,fontWeight:500,color:'#EF4444'}}>拥挤度预警</span>
                    <Tag className="badge-buy" style={{background:'rgba(239,68,68,0.1)',color:'#EF4444'}}>
                      {data.crowding.stock_warnings.length}只
                    </Tag>
                  </Space>
                  <a onClick={()=>navigate('/crowding')} style={{fontSize:12,color:'#EF4444',fontWeight:400,opacity:0.8,transition:'opacity 0.15s'}}
                    onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.8}>详情 →</a>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {data.crowding.stock_warnings.slice(0,18).map(s=>(
                    <Tag key={s.code} onClick={()=>navigate('/stock/'+s.code)}
                      style={{
                        cursor:'pointer',background:'rgba(239,68,68,0.04)',
                        border:'1px solid rgba(239,68,68,0.12)',color:'#EF4444',
                        fontSize:11,margin:0,borderRadius:6,padding:'2px 8px',fontWeight:400,
                        transition:'all 0.15s',
                      }}>
                      {s.name}{s.ret_5d>10 && <FireOutlined style={{marginLeft:3,fontSize:10}}/>}
                    </Tag>
                  ))}
                </div>
              </div>
            </Col>
          )}
          {data.crowding.momentum_candidates?.length>0 && (
            <Col span={data.crowding.stock_warnings?.length>0?12:24}>
              <div className="card" style={{borderLeft:'3px solid #A855F7',padding:'16px 20px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <Space size={8}>
                    <RocketOutlined style={{color:'#A855F7',fontSize:14}}/>
                    <span style={{fontSize:13,fontWeight:500,color:'#A855F7'}}>动量搭车</span>
                    <Tag style={{background:'rgba(168,85,247,0.1)',color:'#A855F7'}}>
                      {data.crowding.momentum_candidates.length}只
                    </Tag>
                  </Space>
                  <a onClick={()=>navigate('/crowding')} style={{fontSize:12,color:'#A855F7',fontWeight:400,opacity:0.8}}>详情 →</a>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {data.crowding.momentum_candidates.slice(0,18).map(s=>(
                    <Tag key={s.code} onClick={()=>navigate('/stock/'+s.code)}
                      style={{
                        cursor:'pointer',background:'rgba(168,85,247,0.04)',
                        border:'1px solid rgba(168,85,247,0.12)',color:'#A855F7',
                        fontSize:11,margin:0,borderRadius:6,padding:'2px 8px',fontWeight:400,
                      }}>
                      {s.name}
                    </Tag>
                  ))}
                </div>
              </div>
            </Col>
          )}
        </Row>
      )}

      {/* 指数行 */}
      <Row gutter={[12,12]} style={{marginBottom:14}}>
        {data.indices.map(idx => <Col flex="1" key={idx.code}><IndexCard item={idx}/></Col>)}
      </Row>

      {/* 三大卡片行 */}
      <Row gutter={[12,12]} style={{marginBottom:14}}>

        {/* 温度计 */}
        <Col xs={24} md={8}>
          <div className="card" style={{height:'100%'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
              <Space size={8}>
                <FundViewOutlined style={{color:'#0052FF',fontSize:14}}/>
                <span className="section-title" style={{marginBottom:0}}>市场温度</span>
              </Space>
              <Tooltip title={
                <div style={{maxWidth:200,fontSize:12,lineHeight:1.7,fontWeight:400}}>
                  <div style={{fontWeight:500,marginBottom:4}}>四维加权</div>
                  <div>估值30% · 资金35% · 趋势20% · 情绪15%</div>
                  <div style={{marginTop:4,color:'#94A3B8'}}>基准：全市场2000只</div>
                </div>
              }>
                <InfoCircleOutlined style={{color:'#CBD5E1',fontSize:13,transition:'color 0.15s'}}
                  onMouseEnter={e=>e.target.style.color='#334155'}
                  onMouseLeave={e=>e.target.style.color='#CBD5E1'}
                />
              </Tooltip>
            </div>
            <ReactECharts option={tempOption} style={{width:'100%',height:148}}/>
            <div style={{textAlign:'center',marginTop:-4}}>
              <Tag className="badge-accent" style={{
                background:'rgba(0,82,255,0.08)',color:'#0052FF',
                fontSize:12,fontWeight:500,padding:'4px 14px',borderRadius:8,marginBottom:8,
                border:'1px solid rgba(0,82,255,0.15)',
              }}>
                {t.label} · 建议仓位 {t.suggested_position}
              </Tag>
              <div style={{fontSize:11,color:'#94A3B8',fontWeight:400,marginTop:4}}>全市场成交额</div>
              <div className="num-lg" style={{fontSize:26,marginTop:2}}>
                {amountWanYi}
                <span style={{fontSize:13,color:'#64748B',fontWeight:400,marginLeft:4,fontFamily:'Inter'}}>万亿</span>
              </div>
            </div>
            <Divider style={{margin:'12px 0 10px'}}/>
            <div style={{display:'flex',gap:14}}>
              {(t.breakdown||[]).map(b => {
                const c = b.label === '估值' ? '#3B82F6' : b.label === '资金' ? '#0052FF' : b.label === '趋势' ? '#22C55E' : '#A855F7';
                return <DimBar key={b.label} label={b.label} score={b.score} color={c}/>;
              })}
            </div>
          </div>
        </Col>

        {/* 信号分布 */}
        <Col xs={24} md={8}>
          <div className="card" style={{height:'100%'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <Space size={8}>
                <ThunderboltOutlined style={{color:'#3B82F6',fontSize:14}}/>
                <span className="section-title" style={{marginBottom:0}}>信号分布</span>
              </Space>
              <span className="font-mono" style={{fontSize:11,color:'#94A3B8',fontWeight:400}}>{signalTotal}只</span>
            </div>
            <div style={{display:'flex',alignItems:'center'}}>
              <ReactECharts option={signalOption} style={{width:'44%',height:182}}/>
              <div style={{flex:1,paddingLeft:8}}>
                {signalKeys.map(k => {
                  const m = signalMeta[k];
                  const count = data.signal_counts[k]||0;
                  const pct = Math.round(count/signalTotal*100);
                  return (
                    <div key={k} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:9}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:7,height:7,borderRadius:'50%',background:m.color,flexShrink:0}}/>
                        <span style={{fontSize:12,color:'#334155',fontWeight:400}}>{m.label}</span>
                      </div>
                      <Space size={8}>
                        <span className="font-mono" style={{fontSize:13,fontWeight:500,color:'#0F172A'}}>{count}</span>
                        <span className="font-mono" style={{fontSize:11,color:'#94A3B8',width:30,textAlign:'right',fontWeight:400}}>{pct}%</span>
                      </Space>
                    </div>
                  );
                })}
              </div>
            </div>
            <Divider style={{margin:'6px 0 10px'}}/>
            <div style={{display:'flex',gap:8}}>
              <div style={{flex:1,padding:'10px 12px',borderRadius:10,background:'rgba(239,68,68,0.06)',border:'1px solid rgba(239,68,68,0.1)'}}>
                <div style={{fontSize:10,color:'#EF4444',fontWeight:500,letterSpacing:'0.04em',textTransform:'uppercase'}}>买入</div>
                <div className="num-md" style={{fontSize:19,fontWeight:500,color:'#EF4444',marginTop:2}}>{buyCount}</div>
              </div>
              <div style={{flex:1,padding:'10px 12px',borderRadius:10,background:'rgba(34,197,94,0.06)',border:'1px solid rgba(34,197,94,0.1)'}}>
                <div style={{fontSize:10,color:'#22C55E',fontWeight:500,letterSpacing:'0.04em',textTransform:'uppercase'}}>减仓</div>
                <div className="num-md" style={{fontSize:19,fontWeight:500,color:'#22C55E',marginTop:2}}>{sellCount}</div>
              </div>
              <div style={{flex:1,padding:'10px 12px',borderRadius:10,background:'#F8FAFC',border:'1px solid #E2E8F0'}}>
                <div style={{fontSize:10,color:'#64748B',fontWeight:500,letterSpacing:'0.04em',textTransform:'uppercase'}}>买卖比</div>
                <div className="num-md" style={{fontSize:19,fontWeight:500,color:'#0F172A',marginTop:2}}>
                  {sellCount>0?(buyCount/sellCount).toFixed(1):'∞'}
                </div>
              </div>
            </div>
          </div>
        </Col>

        {/* 行业涨跌 */}
        <Col xs={24} md={8}>
          <div className="card" style={{height:'100%'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span className="section-title" style={{marginBottom:0}}>行业涨跌</span>
              <div style={{display:'flex',gap:14,alignItems:'center'}}>
                <span style={{fontSize:11,color:'#EF4444',fontWeight:400,display:'flex',alignItems:'center',gap:5}}>
                  <span style={{width:10,height:3,borderRadius:2,background:'#EF4444'}}/>涨
                </span>
                <span style={{fontSize:11,color:'#22C55E',fontWeight:400,display:'flex',alignItems:'center',gap:5}}>
                  <span style={{width:10,height:3,borderRadius:2,background:'#22C55E'}}/>跌
                </span>
              </div>
            </div>
            <ReactECharts option={sectorOption} style={{height:Math.max(196, sectors.length*22+10)}}/>
          </div>
        </Col>
      </Row>

      {/* TOP 推荐 */}
      <div className="card" style={{padding:'20px 22px 10px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <Space size={10} align="center">
            <div style={{
              width:28,height:28,borderRadius:9,
              background:'linear-gradient(135deg,#0052FF,#4D7CFF)',
              display:'flex',alignItems:'center',justifyContent:'center',
              boxShadow:'0 4px 14px rgba(0,82,255,0.25)',
            }}>
              <FireOutlined style={{color:'#fff',fontSize:13}}/>
            </div>
            <div>
              <div style={{fontSize:15,fontWeight:500,color:'#0F172A',lineHeight:1.2}}>TOP 推荐</div>
              <div style={{fontSize:11,color:'#94A3B8',marginTop:2,fontWeight:400}}>
                {data.top_stocks.length} 只高评分股票
              </div>
            </div>
          </Space>
          <a onClick={()=>navigate('/signals')} style={{fontSize:13,color:'#0052FF',fontWeight:500,opacity:0.85,transition:'opacity 0.15s'}}
            onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.85}>查看全部 →</a>
        </div>
        <Table
          columns={topCols}
          dataSource={data.top_stocks}
          rowKey="code"
          pagination={false}
          size="middle"
          onRow={r => ({ style:{cursor:'pointer'}, onClick:()=>navigate('/stock/'+r.code) })}
        />
      </div>
    </div>
  );
}
