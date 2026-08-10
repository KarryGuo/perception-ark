import { useAuth } from '../hooks/useAuth.jsx';

const FEATURES = [
  { icon: '👁️', title: '场景识别', desc: '点击"识别"按钮，拍摄当前画面，播报前方物体及距离，帮助您"看见"周围环境。', color: '#00FFA3' },
  { icon: '🚶', title: '出行避障', desc: '点击"出行"按钮，持续检测前方障碍物，播报物体、距离和避让方向（往左/往右/停下），保障行走安全。', color: '#FFB627' },
  { icon: '🛡️', title: '安全预警', desc: '检测靠近的车辆、障碍物、红绿灯等危险。跌倒自动触发SOS，10秒倒计时联系紧急联系人。', color: '#FF2E7E' },
  { icon: '📖', title: '文字阅读', desc: '点击"阅读"按钮，识别菜单、招牌、药盒、价签等文字信息并播报。', color: '#7B61FF' },
  { icon: '🧭', title: '语音导航', desc: '说"带我去XX"，自动规划步行路线，逐步语音引导。支持目的地搜索和路线记忆。', color: '#00E5FF' },
  { icon: '🆘', title: 'SOS紧急呼救', desc: '点击SOS按钮立即发送位置给紧急联系人，60秒无应答自动拨打120。', color: '#FF2E7E' }
];

const STEPS = [
  '注册账号并登录（视障用户或家属角色）',
  '系统自动定位您的位置并播报天气问候',
  '点击"识别"按钮了解前方有什么，或点击"出行"按钮开始避障检测',
  '说"小舟小舟"唤醒语音助手，直接说出需求，如"带我去五一广场"、"读一下菜单"',
  '遇到危险时系统自动预警，跌倒自动触发SOS',
  '说"我没事"可取消SOS倒计时'
];

export default function Guide() {
  const { user, logout } = useAuth();

  return (
    <div className="guide-page">
      <div className="guide-header">
        <h1>感知方舟 · 产品使用说明</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {user ? (
            <>
              <span style={{ fontSize: '.82rem', color: 'var(--ink-muted)' }}>{user.username}</span>
              <a href="#/">进入系统</a>
              <a href="#/" onClick={logout} style={{ color: 'var(--bio-magenta)' }}>退出</a>
            </>
          ) : (
            <>
              <a href="#/login">登录</a>
              <a href="#/register">注册</a>
            </>
          )}
        </div>
      </div>

      <div className="guide-content">
        <div className="guide-section">
          <h2>产品简介</h2>
          <p>感知方舟（PerceptionArk）是一款专为视障人群设计的AI感知辅助系统。通过摄像头实时感知环境，结合AI视觉模型和语音交互，帮助视障用户安全出行、了解周围环境、阅读文字信息，并在紧急情况下自动呼救。</p>
          <p>系统支持语音唤醒和指令操作，无需手动操作屏幕，真正解放视障用户的双手。</p>
        </div>

        <div className="guide-section">
          <h2>核心功能</h2>
          <div className="guide-feature-grid">
            {FEATURES.map(f => (
              <div className="guide-feature-card" key={f.title}>
                <div className="gfc-icon">{f.icon}</div>
                <div className="gfc-title" style={{ color: f.color }}>{f.title}</div>
                <div className="gfc-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="guide-section">
          <h2>使用流程</h2>
          <ul>
            {STEPS.map((s, i) => (
              <li key={i}>{i + 1}. {s}</li>
            ))}
          </ul>
        </div>

        <div className="guide-section">
          <h2>三大模式说明</h2>
          <h3>识别模式</h3>
          <p>点击"识别"按钮，系统拍摄当前画面并识别其中的物体，播报物体名称和距离。适合静止状态下了解周围环境。</p>
          <h3>出行模式</h3>
          <p>点击"出行"按钮，系统持续检测前方障碍物，播报障碍物类型、距离和避让方向（如"左前方约2米有自行车，请向右避让"）。适合行走时使用，每5秒自动重新检测。</p>
          <h3>红绿灯模式</h3>
          <p>点击"红绿灯"按钮，系统快速检测前方交通灯颜色，红灯立即警报并震动，绿灯提示通行。</p>
        </div>

        <div className="guide-section">
          <h2>语音指令示例</h2>
          <h3>唤醒词</h3>
          <ul>
            <li>"小舟小舟" — 唤醒语音助手</li>
            <li>"小周小周" — 唤醒语音助手</li>
          </ul>
          <h3>导航类</h3>
          <ul>
            <li>"带我去五一广场" — 规划步行路线</li>
            <li>"我要去附近的超市" — 搜索周边地点并导航</li>
            <li>"停止导航" — 结束当前导航</li>
          </ul>
          <h3>识别类</h3>
          <ul>
            <li>"读一下面前的菜单" — 文字识别</li>
            <li>"前面是谁" — 人脸识别</li>
            <li>"描述一下当前场景" — 场景识别</li>
          </ul>
          <h3>模式切换</h3>
          <ul>
            <li>"切换识别" — 切换到识别模式</li>
            <li>"切换导航" — 切换到导航模式</li>
            <li>"打开出行" — 开启出行避障</li>
            <li>"停止" — 停止当前操作和播报</li>
          </ul>
          <h3>紧急类</h3>
          <ul>
            <li>"紧急呼救" — 触发SOS</li>
            <li>"我没事" — 取消SOS倒计时</li>
          </ul>
        </div>

        <div className="guide-section">
          <h2>家属端</h2>
          <p>家属登录后可查看视障用户的实时位置、活动状态、SOS历史记录，管理紧急联系人信息。视障用户绑定家属手机号后，家属即可远程关注用户安全。</p>
          {user ? (
            <p><a href="#/app" style={{ color: 'var(--bio-emerald)' }}>前往家属端 →</a></p>
          ) : (
            <p style={{ color: 'var(--ink-muted)' }}>请先登录后访问家属端。</p>
          )}
        </div>

        <div className="guide-section">
          <h2>注意事项</h2>
          <ul>
            <li>请允许使用摄像头和麦克风权限，否则识别和语音功能无法使用</li>
            <li>建议佩戴耳机使用，避免TTS播报被麦克风重新拾取形成回声</li>
            <li>出行模式会持续使用摄像头和AI识别，建议在需要时开启，安全到达后关闭</li>
            <li>SOS功能需要配置紧急联系人，请提前在设置中添加</li>
            <li>建议保持网络畅通，AI识别需要联网调用云端模型</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
