// Переменные для управления чатом
let currentChatUserId = null;
let messagesInterval = null;
let searchTimeout = null;
/** Предыдущее состояние чатов: id -> { last_message_time, last_message_sender_id } */
let previousChatsState = {};
/** Последние сообщения по чатам: chatUserId -> lastMessageId */
let lastMessageIds = {};
// Переменные для работы с сообщениями
let selectedImage = null;
let imagePreview = null;

// Загрузка списка чатов (без показа загрузки)
async function loadChats() {
    const chatsList = document.getElementById('chatsList');
    if (!chatsList) return;

    // Сохраняем текущее состояние перед обновлением
    const activeUserId = currentChatUserId;
    const wasScrolled = chatsList.scrollTop;
    const hadContent = chatsList.querySelector('.user-item') || chatsList.querySelector('.empty-users');

    try {
        const response = await fetch('/api/chats');
        const data = await response.json();

        if (data.success) {
            if (data.chats.length === 0) {
                // Показываем пустое сообщение только если список действительно пуст
                if (!hadContent) {
                    chatsList.innerHTML = '<div class="empty-users">Нет чатов. Найдите пользователя для начала переписки.</div>';
                }
                previousChatsState = {};
                return;
            }

            // Проверяем новые входящие сообщения для уведомлений (только при обновлении, не при первой загрузке)
            const myId = Number(CURRENT_USER_ID);
            data.chats.forEach(chat => {
                const prev = previousChatsState[chat.id];
                const lastSender = chat.last_message_sender_id != null ? Number(chat.last_message_sender_id) : null;
                const isIncoming = lastSender !== myId && lastSender != null;
                const updated = prev && (String(prev.last_message_time) !== String(chat.last_message_time));
                if (isIncoming && updated) {
                    const raw = chat.last_message || '';
                    const msg = raw.slice(0, 50);
                    const txt = msg ? (msg + (raw.length > 50 ? '…' : '')) : 'Новое сообщение';
                    const senderName = chat.username || chat.phone;
                    showToast('Сообщение от ' + senderName + ': ' + txt);
                    showBrowserNotification('Flitt: ' + senderName, txt);
                }
                previousChatsState[chat.id] = {
                    last_message_time: chat.last_message_time,
                    last_message_sender_id: chat.last_message_sender_id
                };
            });

            // Быстро очищаем и обновляем без показа загрузки
            chatsList.innerHTML = '';

            data.chats.forEach(chat => {
                // Определяем, в сети ли пользователь (например, активен за последнюю минуту)
                let isOnline = false;
                if (chat.last_activity) {
                    const last = new Date(chat.last_activity);
                    const diffMs = Date.now() - last.getTime();
                    if (!isNaN(diffMs) && diffMs <= 60 * 1000) {
                        isOnline = true;
                    }
                }

                const chatItem = document.createElement('div');
                chatItem.className = 'user-item chat-item';
                chatItem.dataset.userId = chat.id;
                
                // Восстанавливаем активное состояние
                if (Number(chat.id) === Number(activeUserId)) {
                    chatItem.classList.add('active');
                    // Обновляем заголовок чата, если открыт чат с этим пользователем
                    const chatUserName = document.getElementById('chatUserName');
                    if (chatUserName) {
                        chatUserName.textContent = chat.username || chat.phone;
                    }
                }
                
                // Форматируем последнее сообщение для отображения
                let previewText = '';
                if (chat.last_message) {
                    const message = chat.last_message.trim();
                    if (message.length > 0) {
                        previewText = message.length > 40 ? message.substring(0, 40) + '...' : message;
                    }
                }
                
                // Определяем отображаемое имя: ник или номер телефона
                const displayName = chat.username || chat.phone;
                
                chatItem.innerHTML = `
                    <div class="user-avatar">
                        ${chat.avatar_path
                            ? `<img src="/uploads/${chat.avatar_path}" alt="${displayName}" class="user-avatar-img">`
                            : `<span>${chat.phone.charAt(chat.phone.length - 2)}${chat.phone.charAt(chat.phone.length - 1)}</span>`
                        }
                        ${isOnline ? '<span class="online-indicator" title="В сети"></span>' : ''}
                    </div>
                    <div class="user-details">
                        <span class="user-name">${displayName}</span>
                        ${previewText ? `<span class="chat-preview">${previewText}</span>` : '<span class="chat-preview" style="opacity: 0.5;">Нет сообщений</span>'}
                    </div>
                `;
                // Добавляем обработчики для клика и тача
                const handleChatOpen = (e) => {
                    e.stopPropagation();
                    openChat(chat.id, chat.phone, chat.username);
                };
                chatItem.addEventListener('click', handleChatOpen);
                chatItem.addEventListener('touchend', handleChatOpen, { passive: true });
                chatsList.appendChild(chatItem);
            });
            
            // Восстанавливаем позицию прокрутки только если был контент
            if (hadContent) {
                chatsList.scrollTop = wasScrolled;
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки чатов:', error);
        // Не показываем ошибку при автоматических обновлениях
    }
}

// Тихая загрузка чатов (алиас для единообразия)
async function silentLoadChats() {
    await loadChats();
}

// Показать in-app тост
function showToast(text) {
    const container = document.getElementById('notificationsContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'notification-toast';
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// Показать браузерное уведомление (если вкладка не в фокусе)
function showBrowserNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return; // тост уже показываем
    try {
        const n = new Notification(title, { body });
        n.onclick = () => { n.close(); window.focus(); };
        setTimeout(() => n.close(), 4000);
    } catch (e) {}
}

// Запросить разрешение на уведомления
function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Поиск пользователей по нику или номеру
async function searchUsers(searchQuery) {
    const usersList = document.getElementById('usersList');
    const chatsList = document.getElementById('chatsList');
    
    const trimmed = searchQuery.trim();
    
    // Показываем результаты поиска (или рекомендации), скрываем список чатов
    chatsList.style.display = 'none';
    usersList.style.display = 'flex';
    // Не показываем индикатор загрузки при поиске

    try {
        console.log('Поиск пользователей, запрос:', trimmed);
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`);
        const data = await response.json();
        
        console.log('Ответ от сервера:', data);

        if (data.success) {
            console.log('Найдено пользователей:', data.users.length);
            if (data.users.length === 0) {
                usersList.innerHTML = '<div class="empty-users">Пользователи не найдены</div>';
                return;
            }

            usersList.innerHTML = '';
            data.users.forEach(user => {
                console.log('Обработка пользователя:', user);
                const userItem = document.createElement('div');
                userItem.className = 'user-item';
                userItem.dataset.userId = user.id;
                const isFriend = !!user.is_friend;
                
                // Определяем отображаемое имя: ник или номер телефона
                const displayName = user.username || user.phone;
                
                userItem.innerHTML = `
                    <div class="user-avatar">
                        <span>${user.phone.charAt(user.phone.length - 2)}${user.phone.charAt(user.phone.length - 1)}</span>
                    </div>
                    <div class="user-details">
                        <span class="user-name">${displayName}</span>
                        ${
                            isFriend
                                ? '<button type="button" class="user-add-friend-btn in-friends" disabled>В друзьях</button>'
                                : '<button type="button" class="user-add-friend-btn">Добавить в друзья</button>'
                        }
                    </div>
                `;
                // Обработчик открытия чата
                const handleUserOpen = (e) => {
                    e.stopPropagation();
                    openChat(user.id, user.phone, user.username);
                };
                userItem.addEventListener('click', handleUserOpen);
                userItem.addEventListener('touchend', handleUserOpen, { passive: true });

                // Обработчик добавления в друзья
                const addFriendBtn = userItem.querySelector('.user-add-friend-btn');
                if (addFriendBtn) {
                    addFriendBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        try {
                            const response = await fetch('/api/friends', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ friend_id: user.id })
                            });
                            const result = await response.json();
                            if (result.success) {
                                if (typeof showToast === 'function') {
                                    showToast('Пользователь добавлен в друзья');
                                }
                                // Обновляем кнопку состояния дружбы
                                addFriendBtn.textContent = 'В друзьях';
                                addFriendBtn.disabled = true;
                                addFriendBtn.classList.add('in-friends');
                                // Обновляем список друзей
                                loadFriends();
                            } else {
                                // Если сервер говорит, что уже в друзьях — тоже обновляем визуально
                                if (result.message === 'Пользователь уже в списке друзей') {
                                    addFriendBtn.textContent = 'В друзьях';
                                    addFriendBtn.disabled = true;
                                    addFriendBtn.classList.add('in-friends');
                                    if (typeof showToast === 'function') {
                                        showToast('Пользователь уже в друзьях');
                                    } else {
                                        alert('Пользователь уже в друзьях');
                                    }
                                    loadFriends();
                                } else if (typeof showToast === 'function') {
                                    showToast(result.message || 'Не удалось добавить в друзья');
                                }
                                else {
                                    alert(result.message || 'Не удалось добавить в друзья');
                                }
                            }
                        } catch (error) {
                            console.error('Ошибка добавления в друзья:', error);
                            if (typeof showToast === 'function') {
                                showToast('Ошибка соединения с сервером');
                            } else {
                                alert('Ошибка соединения с сервером');
                            }
                        }
                    });
                }

                usersList.appendChild(userItem);
            });
        } else {
            usersList.innerHTML = '<div class="error-users">Ошибка поиска</div>';
        }
    } catch (error) {
        console.error('Ошибка поиска пользователей:', error);
        usersList.innerHTML = '<div class="error-users">Ошибка соединения</div>';
    }
}

// Загрузка списка друзей
async function loadFriends() {
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) return;

    try {
        const response = await fetch('/api/friends');
        const data = await response.json();

        if (!data.success) {
            friendsList.innerHTML = '<div class="error-users">Ошибка загрузки друзей</div>';
            return;
        }

        if (!data.friends || data.friends.length === 0) {
            friendsList.innerHTML = '<div class="empty-users">Список друзей пуст</div>';
            return;
        }

        friendsList.innerHTML = '';

        data.friends.forEach(friend => {
            const item = document.createElement('div');
            item.className = 'user-item';
            item.dataset.userId = friend.id;

            // Определяем, в сети ли друг (активен за последнюю минуту)
            let isOnline = false;
            if (friend.last_activity) {
                const last = new Date(friend.last_activity);
                const diffMs = Date.now() - last.getTime();
                if (!isNaN(diffMs) && diffMs <= 60 * 1000) {
                    isOnline = true;
                }
            }

            const displayName = friend.username || friend.phone;
            const phone = friend.phone || '';
            const suffix = phone.length >= 2 ? phone.slice(-2) : '--';

            item.innerHTML = `
                <div class="user-avatar">
                    ${friend.avatar_path
                        ? `<img src="/uploads/${friend.avatar_path}" alt="${displayName}" class="user-avatar-img">`
                        : `<span>${suffix}</span>`
                    }
                    ${isOnline ? '<span class="online-indicator" title="В сети"></span>' : ''}
                </div>
                <div class="user-details">
                    <span class="user-name">${displayName}</span>
                </div>
            `;

            const handleOpen = (e) => {
                e.stopPropagation();
                openChat(friend.id, friend.phone, friend.username);
            };

            item.addEventListener('click', handleOpen);
            item.addEventListener('touchend', handleOpen, { passive: true });

            friendsList.appendChild(item);
        });
    } catch (error) {
        console.error('Ошибка загрузки друзей:', error);
        friendsList.innerHTML = '<div class="error-users">Ошибка соединения</div>';
    }
}

// Открытие чата с пользователем
async function openChat(userId, userPhone, username = null) {
    if (!userId || !userPhone) {
        console.error('openChat: неверные параметры', userId, userPhone);
        return;
    }
    
    currentChatUserId = userId;
    
    // Обновление UI
    const placeholder = document.getElementById('chatPlaceholder');
    const chatWindow = document.getElementById('chatWindow');
    const chatUserName = document.getElementById('chatUserName');
    const chatUserStatus = document.getElementById('chatUserStatus');
    const chatUserAvatarText = document.getElementById('chatUserAvatarText');
    
    if (placeholder) placeholder.style.display = 'none';
    if (chatWindow) chatWindow.style.display = 'flex';
    
    // Отображаем ник, если есть, иначе номер телефона
    if (chatUserName) chatUserName.textContent = username || userPhone;
    if (chatUserStatus) chatUserStatus.textContent = '';
    
    // Устанавливаем аватар (последние две цифры номера)
    if (chatUserAvatarText && userPhone.length >= 2) {
        chatUserAvatarText.textContent = userPhone.slice(-2);
    }

    // Выделение активного пользователя в списке чатов и результатов поиска
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.userId == userId) {
            item.classList.add('active');
        }
    });

    // На мобильных устройствах скрываем список и показываем чат
    if (window.innerWidth <= 768) {
        document.getElementById('usersSidebar').classList.add('hidden');
        document.getElementById('chatArea').classList.add('fullscreen');
    }

    // Загрузка сообщений (прокрутка вниз при открытии)
    await loadMessages(userId, true);

    // Загружаем и отображаем онлайн-статус пользователя
    try {
        const infoResp = await fetch(`/api/user/${userId}`);
        const infoData = await infoResp.json();
        if (infoData.success && infoData.user && chatUserStatus) {
            const lastActivity = infoData.user.last_activity;
            if (lastActivity) {
                const last = new Date(lastActivity);
                const diffMs = Date.now() - last.getTime();
                if (!isNaN(diffMs) && diffMs <= 60 * 1000) {
                    chatUserStatus.textContent = 'в сети';
                } else {
                    chatUserStatus.textContent = 'был(а) недавно';
                }
            } else {
                chatUserStatus.textContent = '';
            }
        }
    } catch (e) {
        console.error('Не удалось получить статус пользователя', e);
    }

    // Автообновление сообщений каждую секунду
    if (messagesInterval) {
        clearInterval(messagesInterval);
    }
    messagesInterval = setInterval(() => loadMessages(userId), 1000);

    // Фокус на поле ввода
    document.getElementById('messageInput').focus();
}

// Загрузка сообщений
async function loadMessages(userId, scrollToBottom = false) {
    try {
        const response = await fetch(`/api/messages?user_id=${userId}`);
        const data = await response.json();

        if (data.success) {
            // Проверяем, появилось ли новое входящее сообщение в текущем чате
            const messages = data.messages || [];
            const chatKey = String(userId);
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                const prevLastId = lastMessageIds[chatKey] || null;
                const lastId = lastMsg.id;
                const isIncoming = Number(lastMsg.sender_id) !== Number(CURRENT_USER_ID);
                if (prevLastId !== null && lastId !== prevLastId && isIncoming) {
                    const raw = lastMsg.message || '';
                    const msgShort = raw.slice(0, 50);
                    const txt = msgShort ? (msgShort + (raw.length > 50 ? '…' : '')) : 'Новое сообщение';
                    const headerNameEl = document.getElementById('chatUserName');
                    const senderName = headerNameEl && headerNameEl.textContent ? headerNameEl.textContent : 'Новый собеседник';
                    showToast('Сообщение от ' + senderName + ': ' + txt);
                    showBrowserNotification('Flitt: ' + senderName, txt);
                }
                lastMessageIds[chatKey] = lastId;
            } else {
                // Если сообщений нет, сбрасываем сохранённый id
                lastMessageIds[chatKey] = null;
            }

            displayMessages(messages, scrollToBottom);
        }
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
    }
}

// Отображение сообщений
function displayMessages(messages, scrollToBottom = true) {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    // Сохраняем текущую позицию прокрутки и высоту
    const wasAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop <= messagesContainer.clientHeight + 100;
    const oldScrollHeight = messagesContainer.scrollHeight;
    
    messagesContainer.innerHTML = '';

    if (messages.length === 0) {
        messagesContainer.innerHTML = '<div class="empty-chat">Пока нет сообщений. Начните переписку!</div>';
        return;
    }

    let lastDate = null;
    messages.forEach((msg, index) => {
        const msgDate = new Date(msg.created_at);
        const currentDate = msgDate.toDateString();
        
        // Добавляем разделитель даты, если дата изменилась
        if (lastDate !== currentDate) {
            const dateSeparator = document.createElement('div');
            dateSeparator.className = 'message-date-separator';
            const dateText = formatDate(msgDate);
            dateSeparator.innerHTML = `<span>${dateText}</span>`;
            messagesContainer.appendChild(dateSeparator);
            lastDate = currentDate;
        }
        
        const messageDiv = document.createElement('div');
        // Приводим к числам для корректного сравнения
        const isSent = Number(msg.sender_id) === Number(CURRENT_USER_ID);
        messageDiv.className = `message ${isSent ? 'message-sent' : 'message-received'}`;
        messageDiv.dataset.messageId = msg.id;
        
        // Обработчики для контекстного меню
        let messageLongPressTimer = null;
        
        messageDiv.addEventListener('contextmenu', (e) => {
            if (typeof window.handleContextMenu === 'function') {
                window.handleContextMenu(e, msg, messageDiv);
            }
        });
        
        // Долгое нажатие для мобильных
        messageDiv.addEventListener('touchstart', (e) => {
            if (typeof window.handleLongPressStart === 'function') {
                window.handleLongPressStart(e, msg, messageDiv);
            }
        });
        
        messageDiv.addEventListener('touchend', (e) => {
            if (typeof window.handleLongPressEnd === 'function') {
                window.handleLongPressEnd(e);
            }
            if (messageLongPressTimer) {
                clearTimeout(messageLongPressTimer);
                messageLongPressTimer = null;
            }
        });
        
        messageDiv.addEventListener('touchmove', (e) => {
            if (messageLongPressTimer) {
                clearTimeout(messageLongPressTimer);
                messageLongPressTimer = null;
            }
            if (typeof window.handleLongPressEnd === 'function') {
                window.handleLongPressEnd(e);
            }
        });
        
        const messageBubble = document.createElement('div');
        messageBubble.className = 'message-bubble';
        
        // Если есть изображение
        if (msg.image_path) {
            const imageContainer = document.createElement('div');
            imageContainer.className = 'message-image-container';
            const img = document.createElement('img');
            img.src = `/uploads/${msg.image_path}`;
            img.alt = 'Изображение';
            img.className = 'message-image';
            img.loading = 'lazy';
            imageContainer.appendChild(img);
            messageBubble.appendChild(imageContainer);
        }
        
        // Если есть текст сообщения
        if (msg.message) {
            const messageText = document.createElement('div');
            messageText.className = 'message-text-content';
            messageText.textContent = msg.message;
            messageBubble.appendChild(messageText);
        }

        const messageTime = document.createElement('div');
        messageTime.className = 'message-time';
        messageTime.textContent = formatTime(msg.created_at);

        messageDiv.appendChild(messageBubble);
        messageDiv.appendChild(messageTime);
        messagesContainer.appendChild(messageDiv);
    });

    // Прокрутка вниз только если нужно или пользователь был внизу
    if (scrollToBottom || wasAtBottom) {
        // Используем requestAnimationFrame для плавной прокрутки
        requestAnimationFrame(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    } else {
        // Сохраняем позицию прокрутки при обновлении
        const newScrollHeight = messagesContainer.scrollHeight;
        const scrollDiff = newScrollHeight - oldScrollHeight;
        messagesContainer.scrollTop += scrollDiff;
    }
}

// Форматирование времени
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Форматирование даты
function formatDate(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (messageDate.getTime() === today.getTime()) {
        return 'Сегодня';
    } else if (messageDate.getTime() === yesterday.getTime()) {
        return 'Вчера';
    } else {
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    }
}

// Управление видимостью кнопок ввода
function updateInputButtons() {
    const messageInput = document.getElementById('messageInput');
    const messageForm = document.getElementById('messageForm');
    if (!messageInput || !messageForm) return;
    
    const hasText = messageInput.value.trim().length > 0;
    const hasImage = selectedImage !== null;
    
    if (hasText || hasImage) {
        messageForm.classList.add('has-text');
    } else {
        messageForm.classList.remove('has-text');
    }
}

// Отправка сообщения
const messageForm = document.getElementById('messageForm');
if (messageForm) {
    messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentChatUserId) return;

        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();

        // Проверяем, редактируем ли мы сообщение
        if (window.editingMessageId) {
            try {
                const response = await fetch(`/api/messages/${window.editingMessageId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: message
                    })
                });

                const data = await response.json();
                
                if (data.success) {
                    messageInput.value = '';
                    messageInput.placeholder = 'Сообщение...';
                    window.editingMessageId = null;
                    updateInputButtons();
                    if (typeof showToast === 'function') {
                        showToast('Сообщение изменено');
                    }
                    // Перезагружаем сообщения
                    await loadMessages(currentChatUserId, false);
                } else {
                    alert('Ошибка изменения сообщения: ' + (data.message || 'Неизвестная ошибка'));
                }
            } catch (error) {
                console.error('Ошибка изменения сообщения:', error);
                alert('Ошибка соединения с сервером');
            }
            return;
        }

        if (!message && !selectedImage) return;

        try {
            const formData = new FormData();
            formData.append('receiver_id', currentChatUserId);
            if (message) {
                formData.append('message', message);
            }
            if (selectedImage) {
                formData.append('image', selectedImage);
            }
            // Добавляем reply_to_id, если отвечаем на сообщение
            if (window.replyToMessage && typeof window.replyToMessage !== 'undefined') {
                formData.append('reply_to_id', window.replyToMessage.id);
            }

            const response = await fetch('/api/messages', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (data.success) {
                messageInput.value = '';
                messageInput.placeholder = 'Сообщение...';
                selectedImage = null;
                window.replyToMessage = null;
                if (imagePreview) {
                    imagePreview.remove();
                    imagePreview = null;
                }
                updateInputButtons();
                // Сначала обновляем список чатов, чтобы чат стал первым
                await silentLoadChats();
                // Затем перезагружаем сообщения (прокрутка вниз после отправки)
                await loadMessages(currentChatUserId, true);
            } else {
                alert('Ошибка отправки сообщения: ' + (data.message || 'Неизвестная ошибка'));
            }
        } catch (error) {
            console.error('Ошибка отправки сообщения:', error);
            alert('Ошибка соединения с сервером');
        }
    });
    
    // Отслеживание изменений в поле ввода
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('input', updateInputButtons);
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                messageForm.dispatchEvent(new Event('submit'));
            }
        });
    }
}

// Кнопка "Назад" для мобильных устройств
const backBtn = document.getElementById('backBtn');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        // На мобильных устройствах показываем список и скрываем чат
        if (window.innerWidth <= 768) {
            document.getElementById('usersSidebar').classList.remove('hidden');
            document.getElementById('chatArea').classList.remove('fullscreen');
            document.getElementById('chatPlaceholder').style.display = 'flex';
            document.getElementById('chatWindow').style.display = 'none';
        }

        // Останавливаем автообновление
        if (messagesInterval) {
            clearInterval(messagesInterval);
            messagesInterval = null;
        }

        currentChatUserId = null;

        // Снимаем выделение активного пользователя
        document.querySelectorAll('.user-item').forEach(item => {
            item.classList.remove('active');
        });
    });
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    // Загружаем список чатов и друзей (тихо, без индикаторов)
    loadChats();
    loadFriends();
    // Запрашиваем разрешение на системные уведомления браузера
    requestNotificationPermission();
    
    // Обработчики для новых кнопок
    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('fileInput');
    
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) {
                    alert('Пожалуйста, выберите изображение');
                    return;
                }
                
                selectedImage = file;
                
                // Показываем превью изображения
                if (imagePreview) {
                    imagePreview.remove();
                }
                
                const reader = new FileReader();
                reader.onload = (e) => {
                    imagePreview = document.createElement('div');
                    imagePreview.className = 'image-preview';
                    imagePreview.innerHTML = `
                        <img src="${e.target.result}" alt="Preview">
                        <button type="button" class="image-preview-remove" aria-label="Удалить">×</button>
                    `;
                    
                    const messageForm = document.getElementById('messageForm');
                    messageForm.parentElement.insertBefore(imagePreview, messageForm);
                    
                    // Кнопка удаления превью
                    const removeBtn = imagePreview.querySelector('.image-preview-remove');
                    removeBtn.addEventListener('click', () => {
                        selectedImage = null;
                        imagePreview.remove();
                        imagePreview = null;
                        fileInput.value = '';
                    });
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    const emojiBtn = document.getElementById('emojiBtn');
    const messageInput = document.getElementById('messageInput');
    let emojiPicker = null;

    function insertEmoji(emoji) {
        if (!messageInput) return;
        const start = typeof messageInput.selectionStart === 'number' ? messageInput.selectionStart : messageInput.value.length;
        const end = typeof messageInput.selectionEnd === 'number' ? messageInput.selectionEnd : messageInput.value.length;
        const value = messageInput.value;
        messageInput.value = value.slice(0, start) + emoji + value.slice(end);
        const newPos = start + emoji.length;
        messageInput.focus();
        try {
            messageInput.setSelectionRange(newPos, newPos);
        } catch (e) {
            // Игнорируем, если браузер не поддерживает
        }
        updateInputButtons();
    }

    function createEmojiPicker() {
        if (emojiPicker) return emojiPicker;
        const container = document.createElement('div');
        container.className = 'emoji-picker';

        const emojis = [
            '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊',
            '😍','😘','😜','🤪','😎','🤩','😏','😇','🥰','🤗',
            '🤔','🤨','😐','😑','😶','🙄','😬','🤥','😭','😢',
            '😡','😠','🤬','🤯','😳','😱','😴','🤤','😷','🤒',
            '👍','👎','🙏','👏','🙌','💪','🤝','👋','🤟','👌',
            '❤️','🧡','💛','💚','💙','💜','🤍','🖤','🤎','✨',
            '🔥','🎉','🎂','🍕','🍔','☕','🍺','⚽','🎧','📷'
        ];

        emojis.forEach((emoji) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emoji-picker-button';
            btn.textContent = emoji;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                insertEmoji(emoji);
                container.classList.remove('emoji-picker-open');
            });
            container.appendChild(btn);
        });

        const chatInputContainer = document.querySelector('.chat-input-container');
        if (chatInputContainer) {
            chatInputContainer.appendChild(container);
        } else {
            document.body.appendChild(container);
        }

        emojiPicker = container;
        return emojiPicker;
    }

    function hideEmojiPicker() {
        if (emojiPicker) {
            emojiPicker.classList.remove('emoji-picker-open');
        }
        document.removeEventListener('click', handleEmojiOutsideClick);
    }

    function handleEmojiOutsideClick(e) {
        if (!emojiPicker) return;
        if (emojiPicker.contains(e.target) || e.target === emojiBtn) return;
        hideEmojiPicker();
    }

    if (emojiBtn && messageInput) {
        emojiBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const picker = createEmojiPicker();
            const isOpen = picker.classList.toggle('emoji-picker-open');

            if (isOpen) {
                document.addEventListener('click', handleEmojiOutsideClick);
                messageInput.focus();
            } else {
                document.removeEventListener('click', handleEmojiOutsideClick);
            }
        });
    }
    
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            // TODO: Реализовать поиск по сообщениям
            console.log('Поиск по сообщениям (пока не реализовано)');
        });
    }
    
    const menuBtnChat = document.getElementById('menuBtnChat');
    if (menuBtnChat) {
        menuBtnChat.addEventListener('click', async () => {
            if (!currentChatUserId) return;
            try {
                const resp = await fetch(`/api/block/status?user_id=${currentChatUserId}`);
                const data = await resp.json();
                if (!data.success || !data.status) return;

                const blockedByMe = !!data.status.blocked_by_me;
                const blockedMe = !!data.status.blocked_me;

                if (blockedByMe) {
                    if (!confirm('Разблокировать этого пользователя?')) return;
                    const respUnblock = await fetch(`/api/block/${currentChatUserId}`, {
                        method: 'DELETE'
                    });
                    const resUnblock = await respUnblock.json();
                    if (resUnblock.success) {
                        if (typeof showToast === 'function') {
                            showToast('Пользователь разблокирован');
                        }
                        // Обновляем списки
                        silentLoadChats();
                        loadFriends();
                    } else {
                        alert(resUnblock.message || 'Не удалось разблокировать пользователя');
                    }
                } else {
                    let text = 'Заблокировать этого пользователя? Он не сможет отправлять вам сообщения, а чат исчезнет из списка.';
                    if (blockedMe) {
                        text = 'Этот пользователь уже заблокировал вас. Также заблокировать его и скрыть чат?';
                    }
                    if (!confirm(text)) return;

                    const respBlock = await fetch('/api/block', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ user_id: currentChatUserId })
                    });
                    const resBlock = await respBlock.json();
                    if (resBlock.success) {
                        if (typeof showToast === 'function') {
                            showToast('Пользователь заблокирован');
                        }
                        // Скрываем текущий чат и обновляем списки
                        const placeholder = document.getElementById('chatPlaceholder');
                        const chatWindow = document.getElementById('chatWindow');
                        if (chatWindow) chatWindow.style.display = 'none';
                        if (placeholder) placeholder.style.display = 'flex';

                        if (messagesInterval) {
                            clearInterval(messagesInterval);
                            messagesInterval = null;
                        }
                        currentChatUserId = null;
                        silentLoadChats();
                        loadFriends();
                    } else {
                        alert(resBlock.message || 'Не удалось заблокировать пользователя');
                    }
                }
            } catch (error) {
                console.error('Ошибка блокировки пользователя:', error);
                alert('Ошибка соединения с сервером');
            }
        });
    }
    
    // Инициализация кнопок ввода
    updateInputButtons();
    
    // Обработка меню
    const menuBtn = document.getElementById('menuBtn');
    const menuDropdown = document.getElementById('menuDropdown');
    const logoutMenuItem = document.getElementById('logoutMenuItem');
    const adminMenuItem = document.getElementById('adminMenuItem');
    
    if (menuBtn && menuDropdown) {
        // Показать/скрыть меню при клике на кнопку
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.classList.toggle('show');
        });
        
        // Закрыть меню при клике вне его
        document.addEventListener('click', (e) => {
            if (!menuBtn.contains(e.target) && !menuDropdown.contains(e.target)) {
                menuDropdown.classList.remove('show');
            }
        });
    }
    
    // Обработка переключения темы
    const themeToggle = document.getElementById('themeToggle');
    const themeToggleText = document.getElementById('themeToggleText');
    if (themeToggle) {
        // Загружаем сохраненную тему
        const savedTheme = localStorage.getItem('theme') || 'dark';
        if (savedTheme === 'light') {
            document.body.classList.remove('theme-dark');
            document.body.classList.add('theme-light');
            if (themeToggleText) themeToggleText.textContent = 'Темная тема';
        }
        
        themeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.contains('theme-dark');
            if (isDark) {
                document.body.classList.remove('theme-dark');
                document.body.classList.add('theme-light');
                localStorage.setItem('theme', 'light');
                if (themeToggleText) themeToggleText.textContent = 'Темная тема';
            } else {
                document.body.classList.remove('theme-light');
                document.body.classList.add('theme-dark');
                localStorage.setItem('theme', 'dark');
                if (themeToggleText) themeToggleText.textContent = 'Светлая тема';
            }
        });
    }
    
    // Обработка выхода из аккаунта
    if (logoutMenuItem) {
        logoutMenuItem.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });
                
                const data = await response.json();
                if (data.success) {
                    window.location.href = data.redirect || '/login';
                }
            } catch (error) {
                console.error('Ошибка выхода:', error);
            }
        });
    }

    // Переход в админку (только если кнопка есть в шаблоне)
    if (adminMenuItem) {
        adminMenuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.href = '/admin';
        });
    }
    
    const searchInput = document.getElementById('searchInput');
    
    if (searchInput) {
        // Поиск с задержкой (debounce)
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            
            if (query.length === 0) {
                // Если поиск пустой, показываем список чатов
                document.getElementById('usersList').style.display = 'none';
                document.getElementById('chatsList').style.display = 'flex';
                loadChats();
                return;
            }
            
            searchTimeout = setTimeout(() => {
                searchUsers(query);
            }, 300); // Задержка 300мс перед поиском
        });
    }
    
    // Автообновление списка чатов каждую секунду (тихо, без визуальных индикаторов)
    setInterval(() => {
        const searchInput = document.getElementById('searchInput');
        if (!currentChatUserId && (!searchInput || searchInput.value.trim() === '')) {
            // Показываем список чатов, если он скрыт
            const chatsList = document.getElementById('chatsList');
            const usersList = document.getElementById('usersList');
            if (chatsList && usersList && usersList.style.display !== 'flex') {
                chatsList.style.display = 'flex';
                usersList.style.display = 'none';
                silentLoadChats();
            } else if (chatsList && chatsList.style.display === 'flex') {
                silentLoadChats();
            }
        }
    }, 1000);
});

// Обработка изменения размера окна
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        // На десктопе всегда показываем обе колонки
        document.getElementById('usersSidebar').classList.remove('hidden');
        document.getElementById('chatArea').classList.remove('fullscreen');
    }
});

// Предотвращение скролла всего контейнера при открытии клавиатуры на мобильных
if (window.innerWidth <= 768) {
    // Предотвращаем скролл body и html
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        let lastScrollTop = 0;
        
        messageInput.addEventListener('focus', (e) => {
            // Сохраняем текущую позицию скролла
            lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
            
            // Предотвращаем скролл body
            window.scrollTo(0, lastScrollTop);
            
            // Прокручиваем сообщения вниз после небольшой задержки (когда клавиатура откроется)
            setTimeout(() => {
                const messagesContainer = document.getElementById('chatMessages');
                if (messagesContainer) {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
                // Убеждаемся, что body не скроллится
                window.scrollTo(0, lastScrollTop);
            }, 100);
            
            setTimeout(() => {
                window.scrollTo(0, lastScrollTop);
            }, 300);
        }, { passive: false });

        // Предотвращаем скролл при вводе
        messageInput.addEventListener('touchstart', (e) => {
            e.stopPropagation();
        }, { passive: true });
        
        // Предотвращаем скролл при изменении размера viewport (открытие клавиатуры)
        window.addEventListener('resize', () => {
            if (document.activeElement === messageInput) {
                window.scrollTo(0, lastScrollTop);
            }
        });
    }

    // Предотвращаем скролл при касании области сообщений
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.addEventListener('touchmove', (e) => {
            // Разрешаем скролл только внутри chat-messages
            e.stopPropagation();
        }, { passive: true });
    }

    // Предотвращаем скролл всего контейнера, но разрешаем клики
    const messengerContainer = document.querySelector('.messenger-container');
    if (messengerContainer) {
        messengerContainer.addEventListener('touchmove', (e) => {
            // Если скролл происходит не в chat-messages и не в списках чатов, предотвращаем его
            if (!e.target.closest('.chat-messages') && 
                !e.target.closest('.chat-input-container') && 
                !e.target.closest('.chats-list') && 
                !e.target.closest('.users-list')) {
                e.preventDefault();
            }
        }, { passive: false });
        
        // НЕ блокируем touchstart, чтобы клики работали
    }
}
