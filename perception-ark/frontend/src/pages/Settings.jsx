import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';

/**
 * 感知方舟 · 设置页面
 * 账户设置(头像/昵称/注销账户) / 问答对话 / 出行模式 / 导航 / 音频 / 无障碍 / 功能引导 / 关于
 * 底部独立区: 切换账号 / 退出登录
 */
export default function Settings() {
  const { user, logout, updateUser } = useAuth();

  // ===== 音频设置 =====
  const [ttsRate, setTtsRate] = useState(() => parseFloat(localStorage.getItem('ark_tts_rate')) || 0.95);
  const [ttsVoiceName, setTtsVoiceName] = useState(() => localStorage.getItem('ark_tts_voice') || '');
  const [availableVoices, setAvailableVoices] = useState([]);
  const [testText, setTestText] = useState('这是一段测试语音，用于预览播报效果。');

  // ===== 问答对话设置 =====
  const [chatStyle, setChatStyle] = useState(() => localStorage.getItem('ark_chat_style') || 'concise');
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('ark_auto_speak') !== 'false');

  // ===== 出行模式设置 =====
  const [obstacleSensitivity, setObstacleSensitivity] = useState(() => localStorage.getItem('ark_obstacle_sens') || 'normal');
  const [vibrationStrength, setVibrationStrength] = useState(() => localStorage.getItem('ark_vibration') || 'strong');

  // ===== 导航设置 =====
  const [navMode, setNavMode] = useState(() => localStorage.getItem('ark_nav_mode') || 'walking');
  const [navVoiceGuide, setNavVoiceGuide] = useState(() => localStorage.getItem('ark_nav_voice') !== 'false');

  // ===== 无障碍设置 =====
  const [largeFont, setLargeFont] = useState(() => localStorage.getItem('ark_large_font') === 'true');
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem('ark_high_contrast') === 'true');

  // ===== 导航历史 =====
  const [navHistory, setNavHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ark_nav_history') || '[]'); }
    catch { return []; }
  });

  // ===== 展开的section =====
  const [expanded, setExpanded] = useState('account'); // 默认展开账户设置

  // ===== 账户设置状态 =====
  const [nicknameInput, setNicknameInput] = useState(user?.nickname || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [accountMsg, setAccountMsg] = useState(null); // { type: 'ok'|'err', text }
  const [confirmDelete, setConfirmDelete] = useState(false); // 注销账户二次确认
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);

  // ===== 修改密码状态 =====
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  // 手机验证码注册的用户(用户名以"用户"+数字开头)可跳过原密码验证
  const isPhoneRegistered = user?.username?.match(/^用户\d+$/);

  // ===== 修改密保状态 =====
  const [showSecForm, setShowSecForm] = useState(false);
  const [secQuestion, setSecQuestion] = useState('您的出生城市是?');
  const [secAnswer, setSecAnswer] = useState('');
  const [secSaving, setSecSaving] = useState(false);

  // ===== 家属绑定状态 =====
  const [familyList, setFamilyList] = useState([]);
  const [familyPhone, setFamilyPhone] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [familyRelation, setFamilyRelation] = useState('');
  const [familyBinding, setFamilyBinding] = useState(false);
  const [familyMsg, setFamilyMsg] = useState(null);

  const loadFamilyList = useCallback(async () => {
    try {
      const res = await api.getFamilyList();
      if (res?.success) setFamilyList(res.list || []);
    } catch (err) {
      console.warn('[Settings] 加载家属列表失败:', err.message);
    }
  }, []);

  const handleBindFamily = useCallback(async () => {
    setFamilyMsg(null);
    if (!familyPhone.trim()) { setFamilyMsg({ type: 'err', text: '请输入家属手机号' }); return; }
    if (!/^1[3-9]\d{9}$/.test(familyPhone.trim())) { setFamilyMsg({ type: 'err', text: '手机号格式不正确' }); return; }
    setFamilyBinding(true);
    try {
      const res = await api.bindFamily(familyPhone.trim(), familyName.trim(), familyRelation.trim());
      if (res?.success) {
        setFamilyMsg({ type: 'ok', text: res.message || (res.status === 'active' ? '家属绑定成功' : '已发送短信邀请') });
        setFamilyPhone(''); setFamilyName(''); setFamilyRelation('');
        loadFamilyList();
      } else {
        setFamilyMsg({ type: 'err', text: res?.error || '绑定失败' });
      }
    } catch (err) {
      setFamilyMsg({ type: 'err', text: `绑定失败: ${err.message}` });
    } finally {
      setFamilyBinding(false);
    }
  }, [familyPhone, familyName, familyRelation, loadFamilyList]);

  const handleUnbindFamily = useCallback(async (bindingId) => {
    if (!confirm('确认解绑该家属?')) return;
    try {
      const res = await api.unbindFamily(bindingId);
      if (res?.success) {
        setFamilyMsg({ type: 'ok', text: '已解绑' });
        loadFamilyList();
      } else {
        setFamilyMsg({ type: 'err', text: res?.error || '解绑失败' });
      }
    } catch (err) {
      setFamilyMsg({ type: 'err', text: `解绑失败: ${err.message}` });
    }
  }, [loadFamilyList]);

  const toggleSection = useCallback((key) => {
    setExpanded(prev => prev === key ? null : key);
  }, []);

  // 同步用户最新的昵称到输入框(如从其他端修改过)
  useEffect(() => {
    setNicknameInput(user?.nickname || '');
  }, [user?.nickname]);

  // 加载可用语音列表
  useEffect(() => {
    const load = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      const cn = voices.filter(v => v.lang.startsWith('zh'));
      setAvailableVoices(cn.length > 0 ? cn : voices);
    };
    load();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, []);

  // 无障碍模式: 大字体/高对比度 实时生效
  useEffect(() => {
    document.body.classList.toggle('ark-large-font', largeFont);
    localStorage.setItem('ark_large_font', String(largeFont));
  }, [largeFont]);
  useEffect(() => {
    document.body.classList.toggle('ark-high-contrast', highContrast);
    localStorage.setItem('ark_high_contrast', String(highContrast));
  }, [highContrast]);

  // 页面加载时获取家属绑定列表
  useEffect(() => {
    loadFamilyList();
  }, [loadFamilyList]);

  const handleSaveRate = useCallback((rate) => {
    localStorage.setItem('ark_tts_rate', String(rate));
    setTtsRate(rate);
  }, []);

  const handleSaveVoice = useCallback((name) => {
    const voices = window.speechSynthesis?.getVoices() || [];
    const v = voices.find(vv => vv.name === name);
    if (v) {
      localStorage.setItem('ark_tts_voice', name);
      setTtsVoiceName(name);
    } else if (name === '') {
      localStorage.removeItem('ark_tts_voice');
      setTtsVoiceName('');
    }
  }, []);

  const handleTestSpeak = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(testText);
    utter.lang = 'zh-CN';
    utter.rate = ttsRate;
    const voices = window.speechSynthesis.getVoices();
    if (ttsVoiceName) {
      const v = voices.find(vv => vv.name === ttsVoiceName);
      if (v) utter.voice = v;
    } else {
      const cn = voices.find(v => v.lang === 'zh-CN') || voices.find(v => v.lang.startsWith('zh'));
      if (cn) utter.voice = cn;
    }
    window.speechSynthesis.speak(utter);
  }, [testText, ttsRate, ttsVoiceName]);

  const handleClearNavHistory = useCallback(() => {
    localStorage.removeItem('ark_nav_history');
    setNavHistory([]);
  }, []);

  const handleRemoveHistoryItem = useCallback((item) => {
    setNavHistory(prev => {
      const updated = prev.filter(i => i !== item);
      localStorage.setItem('ark_nav_history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const goBack = useCallback(() => {
    window.location.hash = '#/app';
  }, []);

  // ===== 账户操作: 修改头像 =====
  const handleAvatarClick = useCallback(() => {
    if (avatarUploading) return;
    fileInputRef.current?.click();
  }, [avatarUploading]);

  const handleAvatarChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 清空input,允许选择同一文件
    if (!file) return;
    // 类型校验
    if (!file.type.startsWith('image/')) {
      setAccountMsg({ type: 'err', text: '请选择图片文件' });
      return;
    }
    // 大小校验: 限制 500KB
    if (file.size > 500 * 1024) {
      setAccountMsg({ type: 'err', text: '图片过大(限制500KB),请压缩后上传' });
      return;
    }
    setAvatarUploading(true);
    setAccountMsg(null);
    try {
      // 读取为 dataURL
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const res = await api.updateAvatar(dataUrl);
      if (res?.success && res.user) {
        updateUser(res.user);
        setAccountMsg({ type: 'ok', text: '头像已更新' });
      } else {
        setAccountMsg({ type: 'err', text: '头像上传失败' });
      }
    } catch (err) {
      setAccountMsg({ type: 'err', text: `头像上传失败: ${err.message}` });
    } finally {
      setAvatarUploading(false);
    }
  }, [updateUser]);

  // ===== 账户操作: 修改昵称 =====
  const handleNicknameSave = useCallback(async () => {
    const trimmed = nicknameInput.trim();
    if (trimmed.length > 20) {
      setAccountMsg({ type: 'err', text: '昵称长度不能超过20个字符' });
      return;
    }
    if (trimmed === (user?.nickname || '')) {
      setAccountMsg({ type: 'ok', text: '昵称未变化' });
      return;
    }
    setNicknameSaving(true);
    setAccountMsg(null);
    try {
      const res = await api.updateNickname(trimmed);
      if (res?.success && res.user) {
        updateUser(res.user);
        setAccountMsg({ type: 'ok', text: '昵称已保存' });
      } else {
        setAccountMsg({ type: 'err', text: '昵称保存失败' });
      }
    } catch (err) {
      setAccountMsg({ type: 'err', text: `昵称保存失败: ${err.message}` });
    } finally {
      setNicknameSaving(false);
    }
  }, [nicknameInput, user?.nickname, updateUser]);

  // ===== 账户操作: 修改密码 =====
  const handlePasswordSave = useCallback(async () => {
    setAccountMsg(null);
    if (!newPwd || newPwd.length < 6) {
      setAccountMsg({ type: 'err', text: '新密码长度至少6位' });
      return;
    }
    if (newPwd !== confirmPwd) {
      setAccountMsg({ type: 'err', text: '两次输入的密码不一致' });
      return;
    }
    // 手机注册用户跳过原密码验证,其他用户需要原密码
    const oldVal = isPhoneRegistered ? 'skip' : oldPwd;
    if (!isPhoneRegistered && !oldPwd) {
      setAccountMsg({ type: 'err', text: '请输入原密码' });
      return;
    }
    setPwdSaving(true);
    try {
      const res = await api.updatePassword(oldVal, newPwd);
      if (res?.success) {
        setAccountMsg({ type: 'ok', text: '密码修改成功' });
        setShowPwdForm(false);
        setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      } else {
        setAccountMsg({ type: 'err', text: res?.error || '密码修改失败' });
      }
    } catch (err) {
      setAccountMsg({ type: 'err', text: `密码修改失败: ${err.message}` });
    } finally {
      setPwdSaving(false);
    }
  }, [oldPwd, newPwd, confirmPwd, isPhoneRegistered]);

  // ===== 账户操作: 修改密保 =====
  const handleSecuritySave = useCallback(async () => {
    setAccountMsg(null);
    if (!secAnswer || !secAnswer.trim()) {
      setAccountMsg({ type: 'err', text: '请填写密保答案' });
      return;
    }
    setSecSaving(true);
    try {
      const res = await api.updateSecurity(secQuestion, secAnswer.trim());
      if (res?.success) {
        setAccountMsg({ type: 'ok', text: '密保问题已更新' });
        setShowSecForm(false);
        setSecAnswer('');
      } else {
        setAccountMsg({ type: 'err', text: res?.error || '密保更新失败' });
      }
    } catch (err) {
      setAccountMsg({ type: 'err', text: `密保更新失败: ${err.message}` });
    } finally {
      setSecSaving(false);
    }
  }, [secQuestion, secAnswer]);

  // ===== 账户操作: 注销账户 =====
  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await api.deleteAccount();
      if (res?.success) {
        // 注销成功: 清token,跳登录页
        localStorage.removeItem('ark_token');
        window.location.hash = '#/login';
        // 强制刷新清空所有内存状态
        window.location.reload();
      } else {
        setAccountMsg({ type: 'err', text: '注销失败,请稍后重试' });
        setConfirmDelete(false);
      }
    } catch (err) {
      setAccountMsg({ type: 'err', text: `注销失败: ${err.message}` });
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }, []);

  // ===== 底部操作: 切换账号 / 退出登录 =====
  const handleSwitchAccount = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
    logout();
    window.location.hash = '#/login';
  }, [logout]);

  const handleLogout = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
    logout();
    window.location.hash = '#/login';
  }, [logout]);

  // 用户显示名: 优先昵称,其次用户名
  const displayName = user?.nickname || user?.username || '未登录';
  // 头像: 优先用户上传头像,其次用首字母占位
  const avatarUrl = user?.avatar;
  const initial = (user?.nickname || user?.username || '?').charAt(0).toUpperCase();

  return (
    <div className="settings-page">
      {/* 顶部导航 */}
      <div className="sp-header">
        <button className="sp-back" onClick={goBack}>← 返回</button>
        <span className="sp-title">⚙️ 设置</span>
        <span className="sp-placeholder" />
      </div>

      <div className="sp-body">
        {/* ===== 账户设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('account')}>
            <span className="sp-section-icon">👤</span>
            <span className="sp-section-title-sm">账户设置</span>
            <span className={`sp-arrow ${expanded === 'account' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'account' && (
            <div className="sp-section-body">
              {/* 头像修改 */}
              <div className="sp-item">
                <label className="sp-label"><span>账户头像</span></label>
                <div className="sp-avatar-row">
                  <div className="sp-avatar-box" onClick={handleAvatarClick} title="点击更换头像">
                    {avatarUploading ? (
                      <span className="sp-avatar-loading">上传中</span>
                    ) : avatarUrl ? (
                      <img src={avatarUrl} alt="头像" className="sp-avatar-img" />
                    ) : (
                      <span className="sp-avatar-initial">{initial}</span>
                    )}
                  </div>
                  <div className="sp-avatar-tip">
                    <button className="sp-avatar-btn" onClick={handleAvatarClick} disabled={avatarUploading}>
                      {avatarUploading ? '上传中...' : '更换头像'}
                    </button>
                    <div className="sp-avatar-hint">支持 JPG/PNG,限制 500KB</div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleAvatarChange}
                  />
                </div>
              </div>

              {/* 昵称修改 */}
              <div className="sp-item">
                <label className="sp-label"><span>账户昵称</span></label>
                <div className="sp-nickname-row">
                  <input
                    type="text"
                    className="sp-input"
                    value={nicknameInput}
                    onChange={e => setNicknameInput(e.target.value)}
                    placeholder="设置一个昵称(最多20字)"
                    maxLength={20}
                    name="ark-settings-nickname-off"
                    autoComplete="nope"
                  />
                  <button
                    className="sp-save-btn"
                    onClick={handleNicknameSave}
                    disabled={nicknameSaving}
                  >
                    {nicknameSaving ? '保存中' : '保存'}
                  </button>
                </div>
              </div>

              {/* 用户名(只读) */}
              <div className="sp-item">
                <label className="sp-label"><span>登录用户名</span></label>
                <div className="sp-user-info">{user?.username || '未登录'}</div>
              </div>

              {/* 用户角色(只读) */}
              <div className="sp-item">
                <label className="sp-label"><span>用户角色</span></label>
                <div className="sp-user-info">{user?.role === 'family' ? '家属' : '使用者'}</div>
              </div>

              {/* 修改密码 */}
              <div className="sp-item">
                <label className="sp-label"><span>登录密码</span></label>
                {!showPwdForm ? (
                  <button className="sp-save-btn sp-action-btn" onClick={() => { setShowPwdForm(true); setAccountMsg(null); }}>
                    {isPhoneRegistered ? '设置密码' : '修改密码'}
                  </button>
                ) : (
                  <div className="sp-pwd-form">
                    {!isPhoneRegistered && (
                      <input
                        type="password"
                        className="sp-input"
                        value={oldPwd}
                        onChange={e => setOldPwd(e.target.value)}
                        placeholder="原密码"
                        name="ark-settings-oldpwd-off"
                        autoComplete="nope"
                      />
                    )}
                    <input
                      type="password"
                      className="sp-input"
                      value={newPwd}
                      onChange={e => setNewPwd(e.target.value)}
                      placeholder="新密码(至少6位)"
                      name="ark-settings-newpwd-off"
                      autoComplete="nope"
                    />
                    <input
                      type="password"
                      className="sp-input"
                      value={confirmPwd}
                      onChange={e => setConfirmPwd(e.target.value)}
                      placeholder="确认新密码"
                      name="ark-settings-confirmpwd-off"
                      autoComplete="nope"
                    />
                    <div className="sp-pwd-actions">
                      <button className="sp-save-btn" onClick={handlePasswordSave} disabled={pwdSaving}>
                        {pwdSaving ? '保存中' : '确认修改'}
                      </button>
                      <button className="sp-cancel-btn" onClick={() => { setShowPwdForm(false); setOldPwd(''); setNewPwd(''); setConfirmPwd(''); setAccountMsg(null); }}>
                        取消
                      </button>
                    </div>
                    {isPhoneRegistered && (
                      <div className="sp-hint">手机注册用户首次设置密码,无需原密码</div>
                    )}
                  </div>
                )}
              </div>

              {/* 修改密保 */}
              <div className="sp-item">
                <label className="sp-label"><span>密保问题</span></label>
                {!showSecForm ? (
                  <button className="sp-save-btn sp-action-btn" onClick={() => { setShowSecForm(true); setAccountMsg(null); }}>
                    设置密保
                  </button>
                ) : (
                  <div className="sp-pwd-form">
                    <select
                      className="sp-select"
                      value={secQuestion}
                      onChange={e => setSecQuestion(e.target.value)}
                    >
                      <option value="您的出生城市是?">您的出生城市是?</option>
                      <option value="您的小学名称是?">您的小学名称是?</option>
                      <option value="您父亲的名字是?">您父亲的名字是?</option>
                      <option value="您母亲的姓氏是?">您母亲的姓氏是?</option>
                      <option value="您的宠物名字是?">您的宠物名字是?</option>
                    </select>
                    <input
                      type="text"
                      className="sp-input"
                      value={secAnswer}
                      onChange={e => setSecAnswer(e.target.value)}
                      placeholder="密保答案"
                      name="ark-settings-secanswer-off"
                      autoComplete="nope"
                    />
                    <div className="sp-pwd-actions">
                      <button className="sp-save-btn" onClick={handleSecuritySave} disabled={secSaving}>
                        {secSaving ? '保存中' : '确认保存'}
                      </button>
                      <button className="sp-cancel-btn" onClick={() => { setShowSecForm(false); setSecAnswer(''); setAccountMsg(null); }}>
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 操作反馈消息 */}
              {accountMsg && (
                <div className={`sp-account-msg ${accountMsg.type}`}>{accountMsg.text}</div>
              )}

              {/* 注销账户(危险操作) */}
              <div className="sp-item sp-danger-zone">
                <label className="sp-label"><span>注销账户</span></label>
                <div className="sp-danger-desc">
                  注销后账户和所有数据将永久删除,无法恢复。请谨慎操作。
                </div>
                {!confirmDelete ? (
                  <button className="sp-danger-btn" onClick={() => setConfirmDelete(true)}>
                    申请注销账户
                  </button>
                ) : (
                  <div className="sp-confirm-delete">
                    <div className="sp-confirm-text">⚠️ 确认要永久注销账户吗?此操作不可撤销!</div>
                    <div className="sp-confirm-actions">
                      <button
                        className="sp-confirm-yes"
                        onClick={handleDeleteAccount}
                        disabled={deleting}
                      >
                        {deleting ? '注销中...' : '确认注销'}
                      </button>
                      <button
                        className="sp-confirm-no"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ===== SOS与家属绑定设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('family')}>
            <span className="sp-section-icon">👨‍👩‍👧</span>
            <span className="sp-section-title-sm">SOS与家属绑定</span>
            <span className={`sp-arrow ${expanded === 'family' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'family' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>绑定家属</span></label>
                <div className="sp-hint" style={{ marginBottom: '10px' }}>
                  输入家属手机号进行绑定。如家属已注册,直接绑定成功;未注册将发送短信邀请。
                </div>
                <div className="sp-pwd-form">
                  <input
                    type="tel"
                    className="sp-input"
                    value={familyPhone}
                    onChange={e => setFamilyPhone(e.target.value)}
                    placeholder="家属手机号(11位)"
                    maxLength={11}
                    name="ark-settings-family-phone-off"
                    autoComplete="nope"
                  />
                  <input
                    type="text"
                    className="sp-input"
                    value={familyName}
                    onChange={e => setFamilyName(e.target.value)}
                    placeholder="家属称呼(可选,如:妈妈)"
                    name="ark-settings-family-name-off"
                    autoComplete="nope"
                  />
                  <input
                    type="text"
                    className="sp-input"
                    value={familyRelation}
                    onChange={e => setFamilyRelation(e.target.value)}
                    placeholder="关系(可选,如:母亲)"
                    name="ark-settings-family-relation-off"
                    autoComplete="nope"
                  />
                  <button
                    className="sp-save-btn sp-action-btn"
                    onClick={handleBindFamily}
                    disabled={familyBinding}
                    style={{ width: '100%' }}
                  >
                    {familyBinding ? '绑定中...' : '绑定家属'}
                  </button>
                </div>
              </div>

              {familyMsg && (
                <div className={`sp-account-msg ${familyMsg.type}`}>{familyMsg.text}</div>
              )}

              {/* 已绑定的家属列表 */}
              {familyList.length > 0 && (
                <div className="sp-item">
                  <label className="sp-label"><span>已绑定家属 ({familyList.length})</span></label>
                  <div className="sp-family-list">
                    {familyList.map(f => (
                      <div key={f.id} className="sp-family-card">
                        <div className="sp-family-info">
                          <div className="sp-family-name">
                            {f.family_name || f.family_phone}
                            {f.relation && <span className="sp-family-relation">({f.relation})</span>}
                          </div>
                          <div className="sp-family-phone">{f.family_phone}</div>
                          <div className={`sp-family-status ${f.status}`}>
                            {f.status === 'active' ? '已绑定' : '待注册'}
                          </div>
                        </div>
                        <button
                          className="sp-unbind-btn"
                          onClick={() => handleUnbindFamily(f.id)}
                          aria-label={`解绑 ${f.family_name || f.family_phone}`}
                        >
                          解绑
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ===== 问答对话设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('chat')}>
            <span className="sp-section-icon">💬</span>
            <span className="sp-section-title-sm">问答对话</span>
            <span className={`sp-arrow ${expanded === 'chat' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'chat' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>回复风格</span></label>
                <select className="sp-select" value={chatStyle}
                  onChange={e => { setChatStyle(e.target.value); localStorage.setItem('ark_chat_style', e.target.value); }}>
                  <option value="concise">简洁模式（50字以内）</option>
                  <option value="detailed">详细模式（100字以内）</option>
                </select>
              </div>
              <div className="sp-item-row">
                <span className="sp-row-label">自动语音播报</span>
                <button className={`sp-switch ${autoSpeak ? 'on' : ''}`}
                  onClick={() => { const v = !autoSpeak; setAutoSpeak(v); localStorage.setItem('ark_auto_speak', String(v)); }}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ===== 出行模式设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('travel')}>
            <span className="sp-section-icon">🚶</span>
            <span className="sp-section-title-sm">出行模式</span>
            <span className={`sp-arrow ${expanded === 'travel' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'travel' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>障碍物检测灵敏度</span></label>
                <select className="sp-select" value={obstacleSensitivity}
                  onChange={e => { setObstacleSensitivity(e.target.value); localStorage.setItem('ark_obstacle_sens', e.target.value); }}>
                  <option value="low">低（仅危险物）</option>
                  <option value="normal">中（默认）</option>
                  <option value="high">高（所有障碍）</option>
                </select>
              </div>
              <div className="sp-item">
                <label className="sp-label"><span>震动反馈强度</span></label>
                <select className="sp-select" value={vibrationStrength}
                  onChange={e => { setVibrationStrength(e.target.value); localStorage.setItem('ark_vibration', e.target.value); }}>
                  <option value="off">关闭震动</option>
                  <option value="weak">弱震动</option>
                  <option value="strong">强震动（默认）</option>
                </select>
              </div>
            </div>
          )}
        </section>

        {/* ===== 导航设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('nav')}>
            <span className="sp-section-icon">🧭</span>
            <span className="sp-section-title-sm">导航设置</span>
            <span className={`sp-arrow ${expanded === 'nav' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'nav' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>默认出行方式</span></label>
                <select className="sp-select" value={navMode}
                  onChange={e => { setNavMode(e.target.value); localStorage.setItem('ark_nav_mode', e.target.value); }}>
                  <option value="walking">步行导航</option>
                  <option value="transit">公交出行</option>
                </select>
              </div>
              <div className="sp-item-row">
                <span className="sp-row-label">导航语音引导</span>
                <button className={`sp-switch ${navVoiceGuide ? 'on' : ''}`}
                  onClick={() => { const v = !navVoiceGuide; setNavVoiceGuide(v); localStorage.setItem('ark_nav_voice', String(v)); }}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
              {navHistory.length > 0 && (
                <div className="sp-item">
                  <label className="sp-label"><span>导航历史记录</span></label>
                  <div className="sp-history-list">
                    {navHistory.map((item, i) => (
                      <div key={i} className="sp-history-item">
                        <span className="sp-history-icon">📍</span>
                        <span className="sp-history-text">{item}</span>
                        <button className="sp-history-del" onClick={() => handleRemoveHistoryItem(item)}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button className="sp-danger-btn" onClick={handleClearNavHistory}>
                    清空全部记录 ({navHistory.length}条)
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ===== 音频设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('audio')}>
            <span className="sp-section-icon">🔊</span>
            <span className="sp-section-title-sm">音频设置</span>
            <span className={`sp-arrow ${expanded === 'audio' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'audio' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label">
                  <span>播报语速</span>
                  <span className="sp-value">{ttsRate.toFixed(2)}x</span>
                </label>
                <input type="range" min="0.5" max="1.5" step="0.05"
                  value={ttsRate}
                  onChange={e => handleSaveRate(parseFloat(e.target.value))}
                  className="sp-slider"
                />
                <div className="sp-marks"><span>慢</span><span>正常</span><span>快</span></div>
              </div>
              <div className="sp-item">
                <label className="sp-label"><span>播报音色</span></label>
                <select className="sp-select" value={ttsVoiceName} onChange={e => handleSaveVoice(e.target.value)}>
                  <option value="">系统默认</option>
                  {availableVoices.map(v => (
                    <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                  ))}
                </select>
              </div>
              <div className="sp-item">
                <label className="sp-label"><span>试听效果</span></label>
                <input type="text" className="sp-input" value={testText}
                  onChange={e => setTestText(e.target.value)} placeholder="输入测试文字..."
                />
                <button className="sp-test-btn" onClick={handleTestSpeak}>🔊 试听</button>
              </div>
            </div>
          )}
        </section>

        {/* ===== 无障碍模式 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('a11y')}>
            <span className="sp-section-icon">♿</span>
            <span className="sp-section-title-sm">无障碍模式</span>
            <span className={`sp-arrow ${expanded === 'a11y' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'a11y' && (
            <div className="sp-section-body">
              <div className="sp-item-row">
                <span className="sp-row-label">大字体模式</span>
                <button className={`sp-switch ${largeFont ? 'on' : ''}`} onClick={() => setLargeFont(v => !v)}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
              <div className="sp-item-row">
                <span className="sp-row-label">高对比度模式</span>
                <button className={`sp-switch ${highContrast ? 'on' : ''}`} onClick={() => setHighContrast(v => !v)}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ===== 功能引导 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('guide')}>
            <span className="sp-section-icon">📖</span>
            <span className="sp-section-title-sm">功能引导</span>
            <span className={`sp-arrow ${expanded === 'guide' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'guide' && (
            <div className="sp-section-body">
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🎙️</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">按住说话</div>
                  <div className="sp-guide-desc">长按底部按钮说话，松开后系统自动识别并回复</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">⚡</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">快速分析</div>
                  <div className="sp-guide-desc">点击后持续分析前方场景，自动播报物体方位和距离</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🚶</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">出行模式</div>
                  <div className="sp-guide-desc">检测前方障碍物，遇到危险紧急播报并震动提醒</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">📖</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">阅读文字</div>
                  <div className="sp-guide-desc">持续识别前方文字内容，适合阅读书本、标签、指示牌</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🚦</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">红绿灯识别</div>
                  <div className="sp-guide-desc">持续检测交通信号灯状态，提醒您何时可安全通过</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🔍</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">寻物模式</div>
                  <div className="sp-guide-desc">说出要找的物品，系统持续寻找并播报方位和距离</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">📱</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">摇一摇</div>
                  <div className="sp-guide-desc">摇动手机可快速开启出行模式</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ===== 关于我们 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('about')}>
            <span className="sp-section-icon">ℹ️</span>
            <span className="sp-section-title-sm">关于我们</span>
            <span className={`sp-arrow ${expanded === 'about' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'about' && (
            <div className="sp-section-body">
              <div className="sp-about">
                <div className="sp-about-name">感知方舟 · PerceptionArk</div>
                <div className="sp-about-version">版本 1.0.0</div>
                <div className="sp-about-desc">面向视障人群的AI智能辅助系统，集成视觉识别、智能导航、安全预警、社交辅助与环境记忆五大核心能力。</div>
              </div>
            </div>
          )}
        </section>

        {/* ===== 底部独立操作区: 切换账号 / 退出登录 ===== */}
        <div className="sp-bottom-actions">
          <div className="sp-current-user">
            当前登录: <span className="sp-current-name">{displayName}</span>
          </div>
          <button className="sp-bottom-btn sp-switch-account-btn" onClick={handleSwitchAccount}>
            🔄 切换账号
          </button>
          <button className="sp-bottom-btn sp-logout-btn" onClick={handleLogout}>
            ⏏ 退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
