import React, { useState, useEffect, createContext, useContext } from 'react';
import { Modal, Form, Input, Button, message, Typography, Space, Avatar, Tag, Tooltip } from 'antd';
import { KeyOutlined, EditOutlined, CheckOutlined, LogoutOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const AuthContext = createContext(null);

// ========== 内置账号库 ==========
// 100个access + 5个admin，uid为8位小写字母+数字，作为唯一登录凭证
// 用户名可在页面内点击修改，修改后保存在浏览器 localStorage
const BUILTIN_ACCOUNTS = [
  // ===== admin账号（5个，拥有策略配置权限）=====
  { uid: 'pw4esfks', username: '李忠兴', role: 'admin' },
  { uid: 'uia1y2qi', username: '超级管理员', role: 'admin' },
  { uid: 'bbtsekvi', username: '系统管理员', role: 'admin' },
  { uid: 'bjaqik9p', username: '运维管理员', role: 'admin' },
  { uid: 'p3tnbmwg', username: '策略管理员', role: 'admin' },
  // ===== access账号（100个，无策略配置权限）=====
  { uid: 'glvdbfhl', username: '张晓明', role: 'access' },
  { uid: '4x05398s', username: '王芳', role: 'access' },
  { uid: 'frt789x6', username: '李强', role: 'access' },
  { uid: '6pwwpirr', username: '刘洋', role: 'access' },
  { uid: 'h7tlkgmc', username: '陈伟', role: 'access' },
  { uid: 'fx7ce1h1', username: '杨静', role: 'access' },
  { uid: 'y0wdtxlp', username: '黄磊', role: 'access' },
  { uid: '5mz6s9p3', username: '赵敏', role: 'access' },
  { uid: 'xwmyjayd', username: '周涛', role: 'access' },
  { uid: 'k4rf237h', username: '吴婷', role: 'access' },
  { uid: '280856xm', username: '徐鹏', role: 'access' },
  { uid: 'd2mtmgr5', username: '孙丽', role: 'access' },
  { uid: 'kx0t7739', username: '马超', role: 'access' },
  { uid: 'e1ivhv2n', username: '朱琳', role: 'access' },
  { uid: 'yf4f1axv', username: '胡斌', role: 'access' },
  { uid: 'e0yjm7he', username: '郭燕', role: 'access' },
  { uid: 'x6flvt4r', username: '何勇', role: 'access' },
  { uid: 'd4tkto5g', username: '林娜', role: 'access' },
  { uid: 'b4ugsiwr', username: '高翔', role: 'access' },
  { uid: 'ewgbb4w9', username: '罗敏', role: 'access' },
  { uid: '7elzhurn', username: '郑浩', role: 'access' },
  { uid: 'e5to516p', username: '梁雪', role: 'access' },
  { uid: '03otw27e', username: '谢东', role: 'access' },
  { uid: 'd8ebselx', username: '宋佳', role: 'access' },
  { uid: 'x15z8roc', username: '唐磊', role: 'access' },
  { uid: 'bk5ebefw', username: '韩梅', role: 'access' },
  { uid: 'zhqbg13p', username: '冯超', role: 'access' },
  { uid: 'oj2tzp7d', username: '邓丽', role: 'access' },
  { uid: 'hxvpycys', username: '曹阳', role: 'access' },
  { uid: 'wj5r3jq0', username: '许静', role: 'access' },
  { uid: '8uy9i503', username: '彭博', role: 'access' },
  { uid: 'fm5o3n2u', username: '曾颖', role: 'access' },
  { uid: '48qtnyzo', username: '萧剑', role: 'access' },
  { uid: 'f3khvhld', username: '田甜', role: 'access' },
  { uid: 'x5mwkl9z', username: '董亮', role: 'access' },
  { uid: 'eo5dz5br', username: '潘悦', role: 'access' },
  { uid: 'p32hahyp', username: '袁野', role: 'access' },
  { uid: 'tcsx33na', username: '蒋萍', role: 'access' },
  { uid: '0zghdwdb', username: '于飞', role: 'access' },
  { uid: 's3u9zeco', username: '余晨', role: 'access' },
  { uid: 'jdf4zz6f', username: '杜鑫', role: 'access' },
  { uid: 'ckrtoupe', username: '叶蕾', role: 'access' },
  { uid: '4oavmobn', username: '程刚', role: 'access' },
  { uid: 'w97qsug2', username: '魏然', role: 'access' },
  { uid: 'df9zb70x', username: '苏畅', role: 'access' },
  { uid: 'zh2te6mq', username: '吕婷', role: 'access' },
  { uid: 't0tc9x5x', username: '丁伟', role: 'access' },
  { uid: 'w3ym7ewo', username: '沈悦', role: 'access' },
  { uid: '874dkglt', username: '任鹏', role: 'access' },
  { uid: 'lvf3e5wh', username: '姚瑶', role: 'access' },
  { uid: 'nn2hgi7p', username: '卢晓', role: 'access' },
  { uid: 'x2n1zvq1', username: '姜涛', role: 'access' },
  { uid: '304q6rw3', username: '崔雪', role: 'access' },
  { uid: 'je8v505s', username: '钟明', role: 'access' },
  { uid: 's2k1tx99', username: '谭静', role: 'access' },
  { uid: 'o7f6hp5e', username: '陆峰', role: 'access' },
  { uid: 'o9jtilu9', username: '范佳', role: 'access' },
  { uid: 'rq7gufge', username: '汪浩', role: 'access' },
  { uid: 'pru1dtg0', username: '廖雅', role: 'access' },
  { uid: 'yve4bqtt', username: '夏丹', role: 'access' },
  { uid: 'y3qxfsfj', username: '蔡明', role: 'access' },
  { uid: 'bzl9ooy0', username: '石磊', role: 'access' },
  { uid: 'aw2tuwd9', username: '贾静', role: 'access' },
  { uid: 'vqu0b5xv', username: '韦强', role: 'access' },
  { uid: 'ugbkfwlr', username: '付颖', role: 'access' },
  { uid: 'oz16kw3r', username: '方圆', role: 'access' },
  { uid: 'qyi5kiem', username: '邹鹏', role: 'access' },
  { uid: 'nuphbplj', username: '熊敏', role: 'access' },
  { uid: '2mlh31jx', username: '孟阳', role: 'access' },
  { uid: '25egvklh', username: '秦丽', role: 'access' },
  { uid: '6hih3qo3', username: '邱伟', role: 'access' },
  { uid: 'yf2a5xtd', username: '白洁', role: 'access' },
  { uid: 'lvfddrdr', username: '江涛', role: 'access' },
  { uid: 'bk8sq4zj', username: '侯雪', role: 'access' },
  { uid: '89pjgyeg', username: '龙斌', role: 'access' },
  { uid: 'gcujrojf', username: '段颖', role: 'access' },
  { uid: '6goqxh1g', username: '雷刚', role: 'access' },
  { uid: '6pb8v8bp', username: '郝娜', role: 'access' },
  { uid: '79mlbf2g', username: '薛飞', role: 'access' },
  { uid: 'g4f5jb11', username: '尹丽', role: 'access' },
  { uid: '4jx1jlbq', username: '钱进', role: 'access' },
  { uid: 'iy3m2sn6', username: '黎安', role: 'access' },
  { uid: 'l2499ztc', username: '易帆', role: 'access' },
  { uid: 'hh0diho5', username: '常悦', role: 'access' },
  { uid: 'gbvfozob', username: '武超', role: 'access' },
  { uid: 'gog3ehmo', username: '乔峰', role: 'access' },
  { uid: 'ojwcfozi', username: '戴琳', role: 'access' },
  { uid: '944g5nin', username: '莫凡', role: 'access' },
  { uid: 'b9lovjlk', username: '孔勇', role: 'access' },
  { uid: '89wxdif3', username: '汤晶', role: 'access' },
  { uid: 'k32ymlw7', username: '向华', role: 'access' },
  { uid: 'zsgqxjpw', username: '庄严', role: 'access' },
  { uid: '39f39mxx', username: '温磊', role: 'access' },
  { uid: '2kx4w4rg', username: '康欣', role: 'access' },
  { uid: 'gkxnqecu', username: '施俊', role: 'access' },
  { uid: 'sxbbm4sy', username: '文涛', role: 'access' },
  { uid: 'at8ap7mh', username: '牛莉', role: 'access' },
  { uid: '46cul5i9', username: '樊华', role: 'access' },
  { uid: 'e1cxxdbq', username: '葛明', role: 'access' },
  { uid: 'den0vyjd', username: '邢远', role: 'access' },
];

// uid 索引
const ACCOUNT_MAP = {};
BUILTIN_ACCOUNTS.forEach(a => { ACCOUNT_MAP[a.uid] = a; });

// ========== 本地存储 key ==========
const CURRENT_UID_KEY = 'cwms_current_uid';
const CUSTOM_NAMES_KEY = 'cwms_custom_names';

function getCustomNames() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_NAMES_KEY) || '{}'); }
  catch(e) { return {}; }
}

function saveCustomName(uid, name) {
  const names = getCustomNames();
  if (name && name.trim()) {
    names[uid] = name.trim();
  } else {
    delete names[uid];
  }
  localStorage.setItem(CUSTOM_NAMES_KEY, JSON.stringify(names));
}

function getDisplayName(uid) {
  const acc = ACCOUNT_MAP[uid];
  if (!acc) return uid;
  return getCustomNames()[uid] || acc.username;
}

function getCurrentUid() {
  return localStorage.getItem(CURRENT_UID_KEY);
}

// 权限判断：admin 全部开放；access 不能访问策略配置(settings)
function hasPermission(uid, module) {
  const acc = ACCOUNT_MAP[uid];
  if (!acc) return false;
  if (acc.role === 'admin') return true;
  if (module === 'settings') return false;
  return true;
}

// ========== AuthProvider ==========
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { uid, username, role }

  useEffect(() => {
    const uid = getCurrentUid();
    if (uid && ACCOUNT_MAP[uid]) {
      setUser({
        uid,
        username: getDisplayName(uid),
        role: ACCOUNT_MAP[uid].role,
      });
    } else {
      // 清理无效 uid
      if (uid) localStorage.removeItem(CURRENT_UID_KEY);
    }
  }, []);

  // Access Key 登录
  const handleAccessLogin = (values) => {
    const key = (values.accessKey || '').trim().toLowerCase();
    if (!key) { message.error('请输入 Access Key'); return; }
    if (key.length !== 8) { message.error('Access Key 格式错误（应为8位字符）'); return; }
    const acc = ACCOUNT_MAP[key];
    if (!acc) { message.error('Access Key 无效，请联系管理员获取正确的 Key'); return; }
    localStorage.setItem(CURRENT_UID_KEY, key);
    const displayName = getDisplayName(key);
    setUser({ uid: key, username: displayName, role: acc.role });
    message.success(`欢迎，${displayName}（${acc.role === 'admin' ? '管理员' : '普通用户'}）`);
  };

  const logout = () => {
    localStorage.removeItem(CURRENT_UID_KEY);
    setUser(null);
  };

  // 用户数据隔离存储（前缀为 uid，与老版本 cwms_{uid}_xxx 格式一致）
  const userStorage = {
    get: (key, def) => {
      if (!user) return def;
      try { return JSON.parse(localStorage.getItem(`cwms_${user.uid}_${key}`)) ?? def; }
      catch(e) { return def; }
    },
    set: (key, val) => {
      if (!user) return;
      localStorage.setItem(`cwms_${user.uid}_${key}`, JSON.stringify(val));
    },
  };

  const refreshUser = () => {
    if (!user) return;
    setUser({ ...user, username: getDisplayName(user.uid) });
  };

  return (
    <AuthContext.Provider value={{
      user,
      logout,
      userStorage,
      hasPermission: (mod) => hasPermission(user?.uid, mod),
      refreshUser,
    }}>
      {children}
      <LoginModal open={!user} onLogin={handleAccessLogin} />
    </AuthContext.Provider>
  );
}

function LoginModal({ open, onLogin }) {
  const [form] = Form.useForm();
  if (!open) return null;
  return (
    <Modal
      open
      title={null}
      footer={null}
      closable={false}
      maskClosable={false}
      centered
      width={400}
    >
      <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
        <div style={{display:'flex',justifyContent:'center',marginBottom:8}}>
          <svg width="40" height="40" viewBox="0 0 32 32" shapeRendering="crispEdges">
            <rect x="8" y="2" width="1" height="1" fill="#0F172A"/><rect x="23" y="2" width="1" height="1" fill="#0F172A"/>
            <rect x="7" y="3" width="1" height="2" fill="#0F172A"/><rect x="24" y="3" width="1" height="2" fill="#0F172A"/>
            <rect x="6" y="5" width="1" height="3" fill="#0F172A"/><rect x="25" y="5" width="1" height="3" fill="#0F172A"/>
            <rect x="5" y="8" width="1" height="5" fill="#0F172A"/><rect x="26" y="8" width="1" height="5" fill="#0F172A"/>
            <rect x="6" y="13" width="1" height="2" fill="#0F172A"/><rect x="25" y="13" width="1" height="2" fill="#0F172A"/>
            <rect x="7" y="15" width="1" height="2" fill="#0F172A"/><rect x="24" y="15" width="1" height="2" fill="#0F172A"/>
            <rect x="8" y="17" width="1" height="1" fill="#0F172A"/><rect x="23" y="17" width="1" height="1" fill="#0F172A"/>
            <rect x="9" y="18" width="14" height="1" fill="#0F172A"/>
            <rect x="7" y="8" width="18" height="2" fill="#0052FF"/>
            <rect x="6" y="10" width="20" height="3" fill="#0052FF"/>
            <rect x="6" y="13" width="20" height="2" fill="#0052FF"/>
            <rect x="7" y="15" width="18" height="2" fill="#0052FF"/>
            <rect x="8" y="17" width="16" height="1" fill="#0052FF" opacity="0.7"/>
            <rect x="9" y="18" width="14" height="1" fill="#4D7CFF" opacity="0.4"/>
            <rect x="15" y="19" width="2" height="5" fill="#0F172A"/>
            <rect x="11" y="24" width="10" height="1" fill="#0F172A"/>
            <rect x="9" y="25" width="14" height="1" fill="#0F172A"/>
          </svg>
        </div>
        <Title level={3} style={{ margin: 0 }}>仓位满上</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>TopUp · A股智能决策助手</Text>
      </div>
      <Form form={form} layout="vertical" onFinish={onLogin} style={{ marginTop: 20 }}>
        <Form.Item
          name="accessKey"
          rules={[
            { required: true, message: '请输入 Access Key' },
            { len: 8, message: 'Access Key 应为8位字符' },
          ]}
        >
          <Input
            prefix={<KeyOutlined style={{ color: '#8E8E93' }} />}
            placeholder="请输入您的 Access Key（8位）"
            size="large"
            autoFocus
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: 2 }}
            maxLength={8}
            onChange={(e) => {
              // 自动小写
              const v = e.target.value.toLowerCase();
              if (v !== e.target.value) form.setFieldValue('accessKey', v);
            }}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" style={{ fontWeight: 600 }}>
          进入系统
        </Button>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            首次使用请联系管理员获取 Access Key
          </Text>
        </div>
      </Form>
    </Modal>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Header 用户徽章：角色标签 + 头像 + 用户名 + 修改用户名 + 退出
export function UserBadge() {
  const { user, logout, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const roleColor = isAdmin ? 'var(--warn)' : 'var(--accent)';
  const roleLabel = isAdmin ? '管理员' : '用户';
  const avatarBg = isAdmin ? 'var(--warn)' : 'var(--accent)';

  const startEdit = () => { setInputVal(user.username); setEditing(true); };

  const commit = () => {
    const name = inputVal.trim();
    if (!name) { message.error('用户名不能为空'); return; }
    saveCustomName(user.uid, name);
    setEditing(false);
    refreshUser();
    message.success('用户名已更新');
  };

  return (
    <Space size={8} align="center">
      <Tag color={roleColor} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>{roleLabel}</Tag>
      {editing ? (
        <Space size={4}>
          <Input
            size="small"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            style={{ width: 90, fontSize: 12 }}
            onPressEnter={commit}
            autoFocus
          />
          <Button
            type="text"
            size="small"
            icon={<CheckOutlined style={{ color: 'var(--down)' }} />}
            onClick={commit}
          />
        </Space>
      ) : (
        <Tooltip title="点击修改用户名">
          <Space size={4} onClick={startEdit} style={{ cursor: 'pointer' }}>
            <Avatar size="small" style={{ background: avatarBg, flexShrink: 0 }}>
              {user.username?.[0] || '?'}
            </Avatar>
            <Text style={{ fontSize: 13 }}>{user.username}</Text>
            <EditOutlined style={{ fontSize: 11, color: '#8E8E93' }} />
          </Space>
        </Tooltip>
      )}
      <Tooltip title="退出登录">
        <LogoutOutlined
          onClick={logout}
          style={{ fontSize: 14, color: '#8E8E93', cursor: 'pointer', marginLeft: 4 }}
        />
      </Tooltip>
    </Space>
  );
}

export { BUILTIN_ACCOUNTS, ACCOUNT_MAP };
