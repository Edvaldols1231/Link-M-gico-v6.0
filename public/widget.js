/**
 * Link Mágico Widget v7.0
 * Widget embedável para chat com IA
 * Mantém compatibilidade com todas as APIs (GROQ, OpenAI, OpenRouter)
 */

(function() {
  'use strict';

  // Prevenir múltiplas inicializações
  if (window.LinkMagicoWidget) {
    return;
  }

  const LinkMagicoWidget = {
    config: {
      robotName: 'Assistente Virtual',
      instructions: 'Seja útil e prestativo',
      primaryColor: '#667eea',
      position: 'bottom-right',
      apiBase: '',
      showBranding: true,
      autoOpen: false,
      welcomeMessage: 'Olá! Como posso ajudar você hoje?'
    },

    state: {
      isOpen: false,
      isLoading: false,
      messages: [],
      widget: null,
      chatContainer: null
    },

    init: function(userConfig) {
      // Merge configurações
      this.config = Object.assign({}, this.config, userConfig);
      
      // Detectar apiBase se não fornecido
      if (!this.config.apiBase) {
        const scripts = document.querySelectorAll('script');
        for (let script of scripts) {
          if (script.src && script.src.includes('widget.js')) {
            const url = new URL(script.src);
            this.config.apiBase = `${url.protocol}//${url.host}`;
            break;
          }
        }
      }

      // Aguardar DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.createWidget());
      } else {
        this.createWidget();
      }
    },

    createWidget: function() {
      // Verificar se já existe
      if (document.getElementById('linkmagico-widget')) {
        return;
      }

      // CSS do widget
      this.injectCSS();

      // Criar container principal
      const widgetContainer = document.createElement('div');
      widgetContainer.id = 'linkmagico-widget';
      widgetContainer.className = `linkmagico-widget ${this.config.position}`;
      
      widgetContainer.innerHTML = `
        <!-- Botão flutuante -->
        <div class="linkmagico-fab" id="linkmagico-fab">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 12H16M8 8H16M8 16H12M3 20.29V5C3 3.9 3.9 3 5 3H19C20.1 3 21 3.9 21 5V15C21 16.1 20.1 17 19 17H6L3 20.29Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="linkmagico-badge" id="linkmagico-badge" style="display: none;">1</div>
        </div>

        <!-- Chat container -->
        <div class="linkmagico-chat" id="linkmagico-chat" style="display: none;">
          <div class="linkmagico-header">
            <div class="linkmagico-header-info">
              <div class="linkmagico-status-dot"></div>
              <div class="linkmagico-header-text">
                <div class="linkmagico-robot-name">${this.config.robotName}</div>
                <div class="linkmagico-status-text">Online</div>
              </div>
            </div>
            <button class="linkmagico-close" id="linkmagico-close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <div class="linkmagico-messages" id="linkmagico-messages">
            <div class="linkmagico-message linkmagico-message-bot">
              <div class="linkmagico-message-content">${this.config.welcomeMessage}</div>
              <div class="linkmagico-message-time">${this.formatTime(new Date())}</div>
            </div>
          </div>

          <div class="linkmagico-input-container">
            <div class="linkmagico-typing" id="linkmagico-typing" style="display: none;">
              <div class="linkmagico-typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span>Digitando...</span>
            </div>
            <div class="linkmagico-input-wrapper">
              <input 
                type="text" 
                id="linkmagico-input" 
                placeholder="Digite sua mensagem..."
                autocomplete="off"
                maxlength="500"
              />
              <button class="linkmagico-send" id="linkmagico-send" disabled>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17 1L8.5 9.5M17 1L11 17L8.5 9.5M17 1L1 7L8.5 9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          ${this.config.showBranding ? `
            <div class="linkmagico-branding">
              Powered by <strong>Link Mágico v7.0</strong>
            </div>
          ` : ''}
        </div>
      `;

      document.body.appendChild(widgetContainer);

      // Referenciar elementos
      this.state.widget = widgetContainer;
      this.state.chatContainer = document.getElementById('linkmagico-chat');

      // Configurar eventos
      this.bindEvents();

      // Auto-abrir se configurado
      if (this.config.autoOpen) {
        setTimeout(() => this.openChat(), 2000);
      }
    },

    injectCSS: function() {
      if (document.getElementById('linkmagico-widget-css')) {
        return;
      }

      const css = `
        .linkmagico-widget {
          position: fixed;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          font-size: 14px;
          line-height: 1.5;
        }

        .linkmagico-widget.bottom-right {
          bottom: 20px;
          right: 20px;
        }

        .linkmagico-widget.bottom-left {
          bottom: 20px;
          left: 20px;
        }

        .linkmagico-widget.top-right {
          top: 20px;
          right: 20px;
        }

        .linkmagico-widget.top-left {
          top: 20px;
          left: 20px;
        }

        .linkmagico-fab {
          width: 56px;
          height: 56px;
          background: ${this.config.primaryColor};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          color: white;
          position: relative;
          border: none;
        }

        .linkmagico-fab:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 25px rgba(0,0,0,0.2);
        }

        .linkmagico-badge {
          position: absolute;
          top: -8px;
          right: -8px;
          background: #ff4757;
          color: white;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
        }

        .linkmagico-chat {
          position: absolute;
          bottom: 70px;
          right: 0;
          width: 350px;
          height: 450px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.15);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: linkmagico-slideUp 0.3s ease-out;
        }

        @keyframes linkmagico-slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .linkmagico-header {
          background: ${this.config.primaryColor};
          color: white;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .linkmagico-header-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .linkmagico-status-dot {
          width: 8px;
          height: 8px;
          background: #00ff88;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .linkmagico-robot-name {
          font-weight: 600;
          font-size: 15px;
        }

        .linkmagico-status-text {
          font-size: 12px;
          opacity: 0.8;
        }

        .linkmagico-close {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: background 0.2s;
        }

        .linkmagico-close:hover {
          background: rgba(255,255,255,0.1);
        }

        .linkmagico-messages {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .linkmagico-messages::-webkit-scrollbar {
          width: 4px;
        }

        .linkmagico-messages::-webkit-scrollbar-thumb {
          background: #ddd;
          border-radius: 2px;
        }

        .linkmagico-message {
          max-width: 80%;
        }

        .linkmagico-message-bot {
          align-self: flex-start;
        }

        .linkmagico-message-user {
          align-self: flex-end;
        }

        .linkmagico-message-content {
          padding: 12px 16px;
          border-radius: 18px;
          word-wrap: break-word;
          line-height: 1.4;
        }

        .linkmagico-message-bot .linkmagico-message-content {
          background: #f1f3f4;
          color: #333;
          border-bottom-left-radius: 4px;
        }

        .linkmagico-message-user .linkmagico-message-content {
          background: ${this.config.primaryColor};
          color: white;
          border-bottom-right-radius: 4px;
        }

        .linkmagico-message-time {
          font-size: 11px;
          color: #999;
          margin-top: 4px;
          text-align: right;
        }

        .linkmagico-message-bot .linkmagico-message-time {
          text-align: left;
        }

        .linkmagico-input-container {
          padding: 16px 20px;
          border-top: 1px solid #eee;
        }

        .linkmagico-typing {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          color: #666;
          font-size: 13px;
        }

        .linkmagico-typing-dots {
          display: flex;
          gap: 2px;
        }

        .linkmagico-typing-dots span {
          width: 4px;
          height: 4px;
          background: #999;
          border-radius: 50%;
          animation: linkmagico-typing 1.4s infinite;
        }

        .linkmagico-typing-dots span:nth-child(2) {
          animation-delay: 0.2s;
        }

        .linkmagico-typing-dots span:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes linkmagico-typing {
          0%, 60%, 100% {
            transform: scale(0.8);
            opacity: 0.5;
          }
          30% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .linkmagico-input-wrapper {
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }

        .linkmagico-input-wrapper input {
          flex: 1;
          border: 1px solid #ddd;
          border-radius: 20px;
          padding: 12px 16px;
          font-size: 14px;
          outline: none;
          resize: none;
          font-family: inherit;
        }

        .linkmagico-input-wrapper input:focus {
          border-color: ${this.config.primaryColor};
        }

        .linkmagico-send {
          background: ${this.config.primaryColor};
          border: none;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: white;
          transition: all 0.2s;
        }

        .linkmagico-send:disabled {
          background: #ddd;
          cursor: not-allowed;
        }

        .linkmagico-send:not(:disabled):hover {
          transform: scale(1.05);
        }

        .linkmagico-branding {
          padding: 8px 20px;
          text-align: center;
          font-size: 11px;
          color: #999;
          border-top: 1px solid #f0f0f0;
          background: #fafafa;
        }

        /* Mobile responsivo */
        @media (max-width: 480px) {
          .linkmagico-chat {
            width: calc(100vw - 40px);
            height: calc(100vh - 100px);
            bottom: 70px;
            right: 20px;
          }
        }
      `;

      const style = document.createElement('style');
      style.id = 'linkmagico-widget-css';
      style.textContent = css;
      document.head.appendChild(style);
    },

    bindEvents: function() {
      const fab = document.getElementById('linkmagico-fab');
      const closeBtn = document.getElementById('linkmagico-close');
      const input = document.getElementById('linkmagico-input');
      const sendBtn = document.getElementById('linkmagico-send');

      // Toggle chat
      fab.addEventListener('click', () => this.toggleChat());
      closeBtn.addEventListener('click', () => this.closeChat());

      // Input events
      input.addEventListener('input', (e) => {
        const hasText = e.target.value.trim().length > 0;
        sendBtn.disabled = !hasText || this.state.isLoading;
      });

      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });

      sendBtn.addEventListener('click', () => this.sendMessage());
    },

    toggleChat: function() {
      if (this.state.isOpen) {
        this.closeChat();
      } else {
        this.openChat();
      }
    },

    openChat: function() {
      this.state.chatContainer.style.display = 'flex';
      this.state.isOpen = true;
      
      // Focus no input
      setTimeout(() => {
        document.getElementById('linkmagico-input').focus();
      }, 300);

      // Esconder badge
      const badge = document.getElementById('linkmagico-badge');
      if (badge) {
        badge.style.display = 'none';
      }
    },

    closeChat: function() {
      this.state.chatContainer.style.display = 'none';
      this.state.isOpen = false;
    },

    sendMessage: function() {
      const input = document.getElementById('linkmagico-input');
      const message = input.value.trim();
      
      if (!message || this.state.isLoading) {
        return;
      }

      // Adicionar mensagem do usuário
      this.addMessage(message, 'user');
      input.value = '';
      document.getElementById('linkmagico-send').disabled = true;

      // Mostrar typing indicator
      this.showTyping();

      // Enviar para API
      this.callChatAPI(message);
    },

    addMessage: function(content, type) {
      const messagesContainer = document.getElementById('linkmagico-messages');
      const messageDiv = document.createElement('div');
      messageDiv.className = `linkmagico-message linkmagico-message-${type}`;
      
      messageDiv.innerHTML = `
        <div class="linkmagico-message-content">${this.escapeHtml(content)}</div>
        <div class="linkmagico-message-time">${this.formatTime(new Date())}</div>
      `;

      messagesContainer.appendChild(messageDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

      // Armazenar no state
      this.state.messages.push({ content, type, timestamp: new Date() });
    },

    showTyping: function() {
      document.getElementById('linkmagico-typing').style.display = 'flex';
      this.state.isLoading = true;
    },

    hideTyping: function() {
      document.getElementById('linkmagico-typing').style.display = 'none';
      this.state.isLoading = false;
      
      // Reabilitar input se tiver texto
      const input = document.getElementById('linkmagico-input');
      const sendBtn = document.getElementById('linkmagico-send');
      sendBtn.disabled = input.value.trim().length === 0;
    },

    callChatAPI: function(message) {
      // Preparar dados para API
      const requestData = {
        message: message,
        robotName: this.config.robotName,
        instructions: this.config.instructions,
        extractedData: this.getPageData()
      };

      // Chamar API original (mantida intacta)
      fetch(`${this.config.apiBase}/chat-universal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        this.hideTyping();
        
        if (data.success && data.response) {
          this.addMessage(data.response, 'bot');
        } else {
          // Usar fallback response se disponível
          const fallbackMsg = data.fallbackResponse || 'Desculpe, não consegui processar sua mensagem no momento.';
          this.addMessage(fallbackMsg, 'bot');
        }
      })
      .catch(error => {
        console.error('Chat API Error:', error);
        this.hideTyping();
        
        // Mensagem de erro amigável
        const errorMsg = 'Desculpe, estou com dificuldades técnicas. Pode tentar novamente?';
        this.addMessage(errorMsg, 'bot');
      });
    },

    getPageData: function() {
      // Extrair dados da página atual para contexto
      return {
        title: document.title,
        url: window.location.href,
        description: this.getMetaContent('description') || '',
        content: this.getPageContent()
      };
    },

    getMetaContent: function(name) {
      const meta = document.querySelector(`meta[name="${name}"], meta[property="og:${name}"]`);
      return meta ? meta.getAttribute('content') : '';
    },

    getPageContent: function() {
      // Extrair texto principal da página (similar ao backend)
      const clone = document.cloneNode(true);
      const scripts = clone.querySelectorAll('script, style, nav, footer, .ads, .advertisement');
      scripts.forEach(el => el.remove());
      
      return clone.body ? clone.body.textContent.trim().substring(0, 2000) : '';
    },

    formatTime: function(date) {
      return date.toLocaleTimeString('pt-BR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    },

    escapeHtml: function(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  };

  // Expor globalmente
  window.LinkMagicoWidget = LinkMagicoWidget;
})();