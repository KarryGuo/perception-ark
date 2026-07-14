import { useState, useEffect, useRef } from 'react';

/**
 * 小舟智能助手悬浮组件
 * - 默认: 右下角悬浮球,显示唤醒词提示
 * - 点击: 展开对话面板
 * - 对话模式: 球体高亮呼吸,显示对话历史
 */
export default function AssistantWidget({ assistant }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  // 自动滚动到底部
  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [assistant.messages, open]);

  // 对话激活时自动展开
  useEffect(() => {
    if (assistant.active) setOpen(true);
  }, [assistant.active]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    assistant.send(text);
    setInput('');
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const status = assistant.thinking
    ? '思考中...'
    : assistant.active
      ? '聆听中...'
      : assistant.listening
        ? `监听"小舟小舟"...`
        : '已关闭';

  return (
    <>
      {/* 悬浮球 */}
      <button
        className={`ark-fab ${assistant.active ? 'active' : ''} ${assistant.listening ? 'listening' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="小舟助手"
        title="小舟助手"
      >
        <span className="ark-fab-pulse"></span>
        <span className="ark-fab-icon">{assistant.active ? '🎙️' : '🤖'}</span>
        {assistant.listening && !assistant.active && (
          <span className="ark-fab-hint">说"小舟小舟"</span>
        )}
      </button>

      {/* 对话面板 */}
      {open && (
        <div className="ark-panel">
          <div className="ark-panel-header">
            <div className="ark-panel-title">
              <span className="ark-dot"></span>
              <span>小舟 · 智能助手</span>
            </div>
            <div className="ark-panel-status">{status}</div>
            <button className="ark-panel-close" onClick={() => setOpen(false)}>×</button>
          </div>

          <div className="ark-messages">
            {assistant.messages.length === 0 && (
              <div className="ark-empty">
                <div className="ark-empty-icon">👋</div>
                <div className="ark-empty-title">你好，我是小舟</div>
                <div className="ark-empty-tip">
                  说出 <strong>"小舟小舟"</strong> 唤醒我，或直接输入指令。<br/>
                  我能帮你：导航、读文字、识别人脸、描述环境、安全检查。
                </div>
              </div>
            )}
            {assistant.messages.map((msg, i) => (
              <div key={i} className={`ark-msg ${msg.role}`}>
                <div className="ark-msg-avatar">{msg.role === 'user' ? '我' : '舟'}</div>
                <div className="ark-msg-bubble">{msg.text}</div>
              </div>
            ))}
            {assistant.thinking && (
              <div className="ark-msg assistant">
                <div className="ark-msg-avatar">舟</div>
                <div className="ark-msg-bubble ark-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="ark-input-bar">
            <button
              className={`ark-mic-btn ${assistant.listening || assistant.active ? 'on' : ''}`}
              onClick={() => assistant.listening || assistant.active ? assistant.stopListening() : assistant.startListening()}
              title={assistant.listening || assistant.active ? '停止监听' : '开启监听'}
            >
              {assistant.listening || assistant.active ? '⏸' : '🎤'}
            </button>
            <input
              type="text"
              className="ark-input"
              placeholder={'输入指令，或说出"小舟小舟"...'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={assistant.thinking}
            />
            <button
              className="ark-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || assistant.thinking}
            >发送</button>
          </div>
          {assistant.messages.length > 0 && (
            <button className="ark-clear-btn" onClick={assistant.clear}>清空对话</button>
          )}
        </div>
      )}
    </>
  );
}
