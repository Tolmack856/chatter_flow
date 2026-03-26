class ChatManager {
    constructor() {
        this.currentChat = null;
        this.chats = [];
        this.apiBase = window.location.origin;
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.messageQueue = [];
        // 🔥 Новые свойства для работы с изображениями
        this.pendingImage = null;
        this.pendingImageName = '';
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        // Навигация
        document.getElementById('back-to-chats')?.addEventListener('click', () => this.showChatList());
        document.getElementById('back-from-profile')?.addEventListener('click', () => this.showChatList());
        
        // Отправка сообщений
        document.getElementById('send-message')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Поиск
        document.getElementById('search-toggle')?.addEventListener('click', () => this.toggleSearch());
        document.getElementById('chat-search')?.addEventListener('input', (e) => this.searchChats(e.target.value));
        
        // Вкладки чатов
        document.querySelectorAll('.chat-list-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.filterChats(e.target.dataset.tab));
        });

        // 🔥 Обработчик выбора изображения
        const imageInput = document.getElementById('image-input');
        if (imageInput) {
            imageInput.addEventListener('change', (e) => this.handleImageSelect(e));
        }
        
        // Кнопка прикрепления (если есть в вашем HTML)
        const attachBtn = document.getElementById('attach-image');
        if (attachBtn) {
            attachBtn.addEventListener('click', () => {
                document.getElementById('image-input')?.click();
            });
        }
    }

    // 🔥 Обработка выбора файла
    handleImageSelect(event) {
        const file = event.target.files[0];
        if (!file || !file.type.startsWith('image/')) {
            this.showErrorMessage('Пожалуйста, выберите изображение');
            event.target.value = '';
            return;
        }

        // Ограничение размера (10 МБ)
        if (file.size > 10 * 1024 * 1024) {
            this.showErrorMessage('Файл слишком большой (макс. 10 МБ)');
            event.target.value = '';
            return;
        }

        this.pendingImage = file;
        this.pendingImageName = file.name;
        
        console.log('🖼️ Изображение готово:', { 
            name: file.name, 
            size: file.size, 
            type: file.type 
        });
        
        // Показываем превью если есть элемент
        this.showImagePreview(file);
        
        // Очищаем input для повторного выбора того же файла
        event.target.value = '';
    }

    // 🔥 Показ превью изображения
    showImagePreview(file) {
        const previewContainer = document.getElementById('image-preview');
        if (!previewContainer) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            previewContainer.innerHTML = `
                <div class="preview-wrapper">
                    <img src="${e.target.result}" alt="preview" class="preview-image">
                    <button type="button" class="preview-remove" title="Убрать">&times;</button>
                </div>
            `;
            previewContainer.style.display = 'block';
            
            previewContainer.querySelector('.preview-remove')?.addEventListener('click', () => {
                this.clearPendingImage();
            });
        };
        reader.readAsDataURL(file);
    }

    // 🔥 Очистка выбранного изображения
    clearPendingImage() {
        this.pendingImage = null;
        this.pendingImageName = '';
        const preview = document.getElementById('image-preview');
        if (preview) {
            preview.style.display = 'none';
            preview.innerHTML = '';
        }
    }

    connectWebSocket() {
        if (!auth.getCurrentUser()) {
            console.log('WebSocket: Пользователь не авторизован');
            return;
        }

        if (this.socket) {
            this.socket.close();
        }

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            
            console.log('Подключаемся к WebSocket:', wsUrl);
            this.socket = new WebSocket(wsUrl);
            
            this.socket.onopen = () => {
                console.log('WebSocket connected successfully');
                this.reconnectAttempts = 0;
                
                this.socket.send(JSON.stringify({
                    type: 'authenticate',
                    userId: auth.getCurrentUser().id
                }));
                
                this.updateWebSocketStatus(true);
                this.processMessageQueue();
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('WebSocket message received:', data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('WebSocket message error:', error);
                }
            };
            
            this.socket.onclose = (event) => {
                console.log('WebSocket disconnected:', event.code, event.reason);
                this.updateWebSocketStatus(false);
                
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                    console.log(`WebSocket: Переподключение через ${delay}ms...`);
                    
                    setTimeout(() => {
                        this.reconnectAttempts++;
                        this.connectWebSocket();
                    }, delay);
                }
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateWebSocketStatus(false);
            };

            if (this.pingInterval) {
                clearInterval(this.pingInterval);
            }
            this.pingInterval = setInterval(() => {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 20000);

        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.updateWebSocketStatus(false);
        }
    }
    
    processMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.handleNewMessage(message);
        }
    }
    
    queueMessage(message) {
        this.messageQueue.push(message);
        if (this.messageQueue.length > 50) {
            this.messageQueue.shift();
        }
    }

    updateWebSocketStatus(connected) {
        const statusElement = document.getElementById('ws-status');
        if (statusElement) {
            statusElement.textContent = connected ? 'Connected' : 'Disconnected';
            statusElement.style.color = connected ? '#4cd964' : '#ff3b30';
        }
    }

    disconnectWebSocket() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.updateWebSocketStatus(false);
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'authenticated':
                console.log('WebSocket authenticated for user:', data.userId);
                this.loadChats();
                break;
                
            case 'message_sent':
                console.log('Message sent confirmation:', data.message);
                this.loadChats();
                break;
                
            case 'new_message':
                console.log('New message received:', data.message);
                this.handleNewMessage(data.message);
                break;
                
            case 'chat_messages':
                console.log('Chat messages received:', data.chatId, data.messages.length);
                this.handleChatMessages(data.chatId, data.messages);
                break;
                
            case 'user_online':
                console.log('User online:', data.userId);
                this.updateUserStatus(data.userId, true);
                break;
                
            case 'user_offline':
                console.log('User offline:', data.userId);
                this.updateUserStatus(data.userId, false);
                break;
                
            case 'pong':
                break;
                
            case 'error':
                console.error('WebSocket error:', data.message);
                break;
        }
    }

    async loadChats(forceUpdate = false) {
        try {
            const response = await fetch(`${this.apiBase}/api/chats`, {
                headers: {
                    'Authorization': `Bearer ${auth.getToken()}`
                }
            });

            if (response.ok) {
                this.chats = await response.json();
                this.renderChats();
                
                if (!this.currentChat && this.chats.length > 0) {
                    const generalChat = this.chats.find(chat => chat.id === 'general-chat');
                    if (generalChat) {
                        this.openChat(generalChat);
                    }
                }
            } else {
                console.error('Error loading chats:', response.status);
            }
        } catch (error) {
            console.error('Error loading chats:', error);
        }
    }

    renderChats() {
        const chatList = document.getElementById('chat-list');
        if (!chatList) return;
        
        chatList.innerHTML = '';

        if (this.chats.length === 0) {
            chatList.innerHTML = '<div class="loading">Чатов пока нет</div>';
            return;
        }

        this.chats.forEach(chat => {
            const lastMessage = chat.lastMessage || { text: 'Нет сообщений', timestamp: new Date() };
            const time = this.formatTime(lastMessage.timestamp);
            const avatarText = chat.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

            const chatItem = document.createElement('li');
            chatItem.className = 'chat-item';
            chatItem.innerHTML = `
                <div class="chat-item-photo">${avatarText}</div>
                <div class="chat-item-info">
                    <div class="chat-item-header">
                        <span class="name">${chat.name}</span>
                        <span class="time">${time}</span>
                    </div>
                    <div class="chat-item-message">
                        <p>${this.escapeHtml(lastMessage.text || '')}</p>
                    </div>
                </div>
            `;

            chatItem.addEventListener('click', () => this.openChat(chat));
            chatList.appendChild(chatItem);
        });
    }

    async openChat(chat) {
        this.currentChat = chat;
        
        document.getElementById('chat-with-name').textContent = chat.name;
        document.getElementById('chat-status').textContent = 'в сети';
        document.getElementById('chat-status').className = 'status-online';
        
        app.showScreen('screen-chat');
        
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'request_messages',
                chatId: chat.id
            }));
        } else {
            await this.loadMessages(chat.id);
        }
        
        document.getElementById('message-input')?.focus();
    }

    async loadMessages(chatId) {
        try {
            const response = await fetch(`${this.apiBase}/api/chats/${chatId}/messages`, {
                headers: {
                    'Authorization': `Bearer ${auth.getToken()}`
                }
            });

            if (response.ok) {
                const messages = await response.json();
                this.renderMessages(messages);
            } else {
                console.error('Error loading messages:', response.status);
                this.showErrorMessage('Ошибка загрузки сообщений');
            }
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showErrorMessage('Ошибка соединения');
        }
    }

    renderMessages(messages) {
        const chatMessages = document.getElementById('chat-messages');
        const loadingIndicator = document.getElementById('loading-messages');
        
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        
        if (!chatMessages) return;
        
        chatMessages.innerHTML = '';

        if (messages.length === 0) {
            chatMessages.innerHTML = '<div class="loading">Нет сообщений</div>';
            return;
        }

        messages.forEach(message => {
            const messageElement = this.createMessageElement(message);
            if (message.isTemp) {
                messageElement.classList.add('temp-message');
            }
            chatMessages.appendChild(messageElement);
        });

        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    createMessageElement(message) {
        const container = document.createElement('div');
        const isSent = message.senderId === auth.getCurrentUser().id;
        
        container.className = `chat-message-container ${isSent ? 'sent' : 'received'}`;
        container.setAttribute('data-message-id', message.id);
        
        const time = this.formatTime(message.timestamp);
        const senderName = message.sender ? message.sender.fullname : 'Неизвестный';
        const avatarText = message.sender ? 
            message.sender.fullname.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
            '??';

        // 🔥 Рендер изображения если есть
        const imageHtml = message.image ? `
            <div class="message-image">
                <img src="${message.image}" alt="${message.imageName || 'Изображение'}" 
                     class="chat-image" loading="lazy" style="max-width: 100%; border-radius: 12px; margin: 4px 0;">
                ${message.imageName ? `<span class="image-name" style="font-size: 11px; color: #8e8e93; display: block;">${this.escapeHtml(message.imageName)}</span>` : ''}
            </div>
        ` : '';

        const textHtml = message.text ? `<div class="message-text">${this.escapeHtml(message.text)}</div>` : '';

        if (isSent) {
            container.innerHTML = `
                <div class="chat-message-bubble" style="display: flex; flex-direction: column; align-items: flex-end;">
                    ${imageHtml}
                    ${textHtml}
                </div>
                <div class="chat-message-time">${time}</div>
            `;
        } else {
            container.innerHTML = `
                <div class="message-sender-info">
                    <div class="message-avatar">${avatarText}</div>
                    <div class="message-content">
                        <div class="sender-name">${senderName}</div>
                        <div class="chat-message-bubble" style="display: flex; flex-direction: column; align-items: flex-start;">
                            ${imageHtml}
                            ${textHtml}
                        </div>
                        <div class="chat-message-time">${time}</div>
                    </div>
                </div>
            `;
        }
        
        return container;
    }
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    addMessageToChat(message) {
        const messageElement = this.createMessageElement(message);
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    // 🔥 Основная функция отправки с поддержкой изображений
    async sendMessage() {
        const input = document.getElementById('message-input');
        const sendButton = document.getElementById('send-message');
        const text = input?.value.trim() || '';

        // 🔥 Проверка: есть ли контент (текст ИЛИ изображение)
        const hasContent = text.length > 0;
        const hasImage = !!this.pendingImage;
        
        console.log('🔍 Проверка перед отправкой:', {
            hasContent,
            hasImage,
            hasImageBlob: this.pendingImage instanceof Blob,
            contentLength: text.length,
            imageLength: this.pendingImage?.size
        });

        if (!hasContent && !hasImage) {
            console.warn('⚠️ Нет контента для отправки (ни текста, ни изображения)');
            return;
        }

        if (!this.currentChat) {
            console.warn('⚠️ Нет активного чата');
            return;
        }

        // Блокируем интерфейс
        if (input) input.disabled = true;
        if (sendButton) sendButton.disabled = true;
        if (input) input.classList.add('sending');
        
        try {
            const messageText = text;
            const imageBlob = this.pendingImage;
            const imageName = this.pendingImageName;
            
            // Очищаем поля ввода сразу
            if (input) input.value = '';
            this.clearPendingImage();
            
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                await this.sendMessageViaWebSocket(messageText, imageBlob, imageName);
            } else {
                console.log('WebSocket not connected, using HTTP');
                const message = await this.sendMessageViaHTTP(messageText, imageBlob, imageName);
                this.addMessageToChat(message);
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.showErrorMessage('Ошибка отправки сообщения');
        } finally {
            if (input) input.disabled = false;
            if (sendButton) sendButton.disabled = false;
            if (input) input.classList.remove('sending');
            if (input) input.focus();
        }
    }
    
    // 🔥 Отправка через WebSocket (изображение как base64)
    async sendMessageViaWebSocket(text, imageBlob, imageName) {
        let imageData = null;
        
        if (imageBlob) {
            imageData = await this.blobToBase64(imageBlob);
        }
        
        const payload = {
            type: 'send_message',
            chatId: this.currentChat.id,
            text: text,
            image: imageData,
            imageName: imageName
        };
        
        this.socket.send(JSON.stringify(payload));
        
        // Показываем локальное сообщение для мгновенного отклика
        const tempMessage = {
            id: 'temp-' + Date.now(),
            text: text,
            image: imageData,
            imageName: imageName,
            chatId: this.currentChat.id,
            senderId: auth.getCurrentUser().id,
            timestamp: new Date().toISOString(),
            sender: {
                id: auth.getCurrentUser().id,
                username: auth.getCurrentUser().username,
                fullname: auth.getCurrentUser().fullname
            },
            isTemp: true
        };
        
        this.addMessageToChat(tempMessage);
    }
    
    // 🔥 Отправка через HTTP с FormData
    async sendMessageViaHTTP(text, imageBlob, imageName) {
        const formData = new FormData();
        formData.append('text', text || '');
        
        if (imageBlob) {
            formData.append('image', imageBlob, imageName);
        }
        
        const response = await fetch(`${this.apiBase}/api/chats/${this.currentChat.id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${auth.getToken()}`
                // Content-Type не устанавливаем — браузер добавит boundary автоматически
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.text().catch(() => null);
            throw new Error(`HTTP send failed: ${response.status} ${errorData || ''}`);
        }

        return await response.json();
    }
    
    // 🔥 Вспомогательная функция: Blob → base64
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    showErrorMessage(text) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = text;
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff3b30;
            color: white;
            padding: 10px 20px;
            border-radius: 10px;
            z-index: 1000;
        `;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            document.body.removeChild(errorDiv);
        }, 3000);
    }

    handleNewMessage(message) {
        const existingMessage = document.querySelector(`[data-message-id="${message.id}"]`);
        if (existingMessage) {
            console.log('Message already exists, skipping');
            return;
        }
        
        if (this.currentChat && message.chatId === this.currentChat.id) {
            this.addMessageToChat(message);
        }
        
        this.loadChats();
    }
    
    handleChatMessages(chatId, messages) {
        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages(messages);
        }
    }

    showChatList() {
        app.showScreen('screen-main');
        this.currentChat = null;
        this.loadChats();
    }

    toggleSearch() {
        const searchContainer = document.getElementById('search-container');
        if (!searchContainer) return;
        
        const isVisible = searchContainer.style.display === 'block';
        searchContainer.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            document.getElementById('chat-search')?.focus();
        }
    }

    searchChats(query) {
        const chatItems = document.querySelectorAll('.chat-item');
        const searchTerm = query.toLowerCase();
        
        chatItems.forEach(item => {
            const name = item.querySelector('.name')?.textContent.toLowerCase() || '';
            const message = item.querySelector('.chat-item-message p')?.textContent.toLowerCase() || '';
            
            if (name.includes(searchTerm) || message.includes(searchTerm)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    filterChats(filter) {
        document.querySelectorAll('.chat-list-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${filter}"]`)?.classList.add('active');
        this.renderChats();
    }

    updateUserStatus(userId, isOnline) {
        if (this.currentChat && this.currentChat.participants?.includes(userId)) {
            const statusElement = document.getElementById('chat-status');
            if (statusElement) {
                statusElement.textContent = isOnline ? 'в сети' : 'не в сети';
                statusElement.className = isOnline ? 'status-online' : 'status-offline';
            }
        }
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 24 * 60 * 60 * 1000) {
            return date.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        } 
        else if (diff < 48 * 60 * 60 * 1000) {
            return `вчера в ${date.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })}`;
        }
        else {
            return date.toLocaleDateString('ru-RU', { 
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
}
