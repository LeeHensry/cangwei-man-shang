import React, { useState, useEffect, createContext, useContext } from 'react';
import { Modal, Form, Input, Button, message, Tabs, Typography, Space, Avatar } from 'antd';
import { UserOutlined, LockOutlined, KeyOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const AuthContext = createContext(null);

// 简单密码哈希（非加密级，仅混淆）
function hashPassword(pwd, salt) {
  let h = 0;
  const s = pwd + ':' + salt;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return 'h_' + Math.abs(h).toString(36) + '_' + s.length;
}

function getUsers() {
  return JSON.parse(localStorage.getItem('cwms_users') || '{}');
}

function saveUsers(users) {
  localStorage.setItem('cwms_users', JSON.stringify(users));
}

function getCurrentUserId() {
  return localStorage.getItem('cwms_current_user') || null;
}

// AuthProvider - 提供登录状态
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('login');

  useEffect(() => {
    const uid = getCurrentUserId();
    if (uid) {
      const users = getUsers();
      if (users[uid]) {
        setUser({ id: uid, username: users[uid].username });
        return;
      }
    }
    // 没有登录，显示登录框
    setModalOpen(true);
  }, []);

  const handleLogin = (values) => {
    const { username, password } = values;
    const users = getUsers();
    const entry = Object.entries(users).find(([_, u]) => u.username === username);
    if (!entry) { message.error('用户不存在'); return; }
    const [uid, u] = entry;
    if (u.passwordHash !== hashPassword(password, u.salt)) {
      message.error('密码错误');
      return;
    }
    localStorage.setItem('cwms_current_user', uid);
    setUser({ id: uid, username: u.username });
    setModalOpen(false);
    message.success(`欢迎回来，${u.username}`);
  };

  const handleRegister = (values) => {
    const { username, password, confirm } = values;
    if (password !== confirm) { message.error('两次密码不一致'); return; }
    if (password.length < 4) { message.error('密码至少4位'); return; }
    const users = getUsers();
    if (Object.values(users).some(u => u.username === username)) {
      message.error('用户名已存在');
      return;
    }
    const salt = Math.random().toString(36).slice(2, 10);
    const uid = 'u_' + Date.now().toString(36);
    users[uid] = {
      username,
      salt,
      passwordHash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    };
    saveUsers(users);
    // 初始化该用户数据
    localStorage.setItem(`cwms_${uid}_portfolio`, JSON.stringify([]));
    localStorage.setItem(`cwms_${uid}_settings`, JSON.stringify({}));
    localStorage.setItem('cwms_current_user', uid);
    setUser({ id: uid, username });
    setModalOpen(false);
    message.success('注册成功，欢迎使用仓位满上');
  };

  const logout = () => {
    localStorage.removeItem('cwms_current_user');
    setUser(null);
    setModalOpen(true);
    setActiveTab('login');
  };

  // 给子组件获取用户数据（按userId隔离）
  const userStorage = {
    get: (key, def) => {
      if (!user) return def;
      try { return JSON.parse(localStorage.getItem(`cwms_${user.id}_${key}`)) ?? def; }
      catch(e) { return def; }
    },
    set: (key, val) => {
      if (!user) return;
      localStorage.setItem(`cwms_${user.id}_${key}`, JSON.stringify(val));
    },
  };

  return (
    <AuthContext.Provider value={{ user, logout, userStorage }}>
      {children}
      <Modal
        open={modalOpen}
        title={null}
        footer={null}
        closable={false}
        maskClosable={false}
        centered
        width={400}
      >
        <div style={{ textAlign:'center', padding:'20px 0 8px' }}>
          <div style={{ fontSize:42, marginBottom:8 }}>🥃</div>
          <Title level={3} style={{margin:0}}>仓位满上</Title>
          <Text type="secondary" style={{fontSize:13}}>TopUp · A股智能决策助手</Text>
        </div>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          centered
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form layout="vertical" onFinish={handleLogin} style={{marginTop:16}}>
                  <Form.Item name="username" rules={[{required:true,message:'请输入用户名'}]}>
                    <Input prefix={<UserOutlined/>} placeholder="用户名" size="large" autoFocus/>
                  </Form.Item>
                  <Form.Item name="password" rules={[{required:true,message:'请输入密码'}]}>
                    <Input.Password prefix={<LockOutlined/>} placeholder="密码" size="large"/>
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block size="large">登录</Button>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form layout="vertical" onFinish={handleRegister} style={{marginTop:16}}>
                  <Form.Item name="username" rules={[{required:true,message:'请设置用户名'},{min:2,message:'至少2个字符'}]}>
                    <Input prefix={<UserOutlined/>} placeholder="用户名" size="large" autoFocus/>
                  </Form.Item>
                  <Form.Item name="password" rules={[{required:true,message:'请设置密码'}]}>
                    <Input.Password prefix={<KeyOutlined/>} placeholder="密码（至少4位）" size="large"/>
                  </Form.Item>
                  <Form.Item name="confirm" rules={[{required:true,message:'请确认密码'}]}>
                    <Input.Password prefix={<LockOutlined/>} placeholder="确认密码" size="large"/>
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block size="large">注册并登录</Button>
                  <div style={{textAlign:'center',marginTop:12}}>
                    <Text type="secondary" style={{fontSize:11}}>
                      账号数据保存在浏览器本地，清除浏览器数据会丢失
                    </Text>
                  </div>
                </Form>
              ),
            }
          ]}
        />
      </Modal>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Header用户组件（显示用户+退出按钮）
export function UserBadge() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <Space size={8} onClick={logout} style={{cursor:'pointer'}}>
      <Avatar size="small" style={{background:'#1677ff'}}>{user.username?.[0]?.toUpperCase()}</Avatar>
      <Text style={{fontSize:13}}>{user.username}</Text>
      <Text type="secondary" style={{fontSize:11}}>退出</Text>
    </Space>
  );
}
