// Контекстное меню для сообщений
let contextMenu = null;
let currentMessage = null;
let longPressTimer = null;
let isLongPress = false;

// Инициализация контекстного меню
function initContextMenu() {
    contextMenu = document.getElementById('messageContextMenu');
    if (!contextMenu) return;
    
    // Закрытие меню при клике вне его
    document.addEventListener('click', (e) => {
        if (contextMenu && contextMenu.classList.contains('show')) {
            if (!contextMenu.contains(e.target) && !e.target.closest('.message-bubble')) {
                closeContextMenu();
            }
        }
    });
    
    // Закрытие меню при нажатии Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && contextMenu && contextMenu.classList.contains('show')) {
            closeContextMenu();
        }
    });
    
    // Обработчики для пунктов меню
    setupContextMenuHandlers();
}

// Настройка обработчиков пунктов меню
function setupContextMenuHandlers() {
    const actions = {
        reply: handleReply,
        edit: handleEdit,
        pin: handlePin,
        copy: handleCopy,
        forward: handleForward,
        select: handleSelect,
        delete: handleDelete
    };
    
    Object.keys(actions).forEach(action => {
        const button = document.getElementById(`contextMenu${action.charAt(0).toUpperCase() + action.slice(1)}`);
        if (button) {
            button.addEventListener('click', () => {
                if (currentMessage) {
                    actions[action](currentMessage);
                    closeContextMenu();
                }
            });
        }
    });
}

// Показать контекстное меню
function showContextMenu(message, x, y, messageElement) {
    if (!contextMenu || !message) return;
    
    currentMessage = message;
    
    // Обновляем превью сообщения
    updateContextMenuPreview(message);
    
    // Показываем/скрываем пункты меню в зависимости от типа сообщения
    updateContextMenuItems(message);
    
    // Позиционируем меню
    positionContextMenu(x, y);
    
    contextMenu.classList.add('show');
    
    // Сохраняем ссылку на элемент сообщения для выделения
    if (messageElement) {
        messageElement.classList.add('message-context-active');
    }
}

// Обновление превью сообщения в меню
function updateContextMenuPreview(message) {
    const messageTextEl = document.getElementById('contextMenuMessageText');
    const messageMetaEl = document.getElementById('contextMenuMessageMeta');
    
    if (!messageTextEl || !messageMetaEl) return;
    
    // Текст сообщения
    let previewText = '';
    if (message.image_path) {
        previewText = '📷 Фото';
    }
    if (message.message) {
        previewText = message.message;
    }
    if (!previewText) {
        previewText = 'Сообщение';
    }
    
    // Обрезаем длинный текст
    if (previewText.length > 50) {
        previewText = previewText.substring(0, 50) + '...';
    }
    
    messageTextEl.textContent = previewText;
    
    // Метаданные (время и просмотры)
    const date = new Date(message.created_at);
    const timeStr = formatContextMenuTime(date);
    const viewsStr = formatViews(0); // Пока всегда 0, можно добавить в БД позже
    
    messageMetaEl.innerHTML = `
        <span>${timeStr}</span>
        <span>•</span>
        <span>${viewsStr}</span>
    `;
}

// Форматирование времени для контекстного меню
function formatContextMenuTime(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    if (messageDate.getTime() === today.getTime()) {
        return `сегодня в ${timeStr}`;
    } else if (messageDate.getTime() === yesterday.getTime()) {
        return `вчера в ${timeStr}`;
    } else {
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ` в ${timeStr}`;
    }
}

// Форматирование просмотров
function formatViews(views) {
    if (views === 0) return '0';
    if (views < 1000) return views.toString();
    if (views < 1000000) {
        return (views / 1000).toFixed(1) + 'K';
    }
    return (views / 1000000).toFixed(1) + 'M';
}

// Обновление видимости пунктов меню
function updateContextMenuItems(message) {
    const isSent = Number(message.sender_id) === Number(CURRENT_USER_ID);
    
    // "Изменить" и "Удалить" только для своих сообщений
    const editBtn = document.getElementById('contextMenuEdit');
    const deleteBtn = document.getElementById('contextMenuDelete');
    
    if (editBtn) {
        editBtn.style.display = isSent ? 'flex' : 'none';
    }
    if (deleteBtn) {
        deleteBtn.style.display = isSent ? 'flex' : 'none';
    }
    
    // "Копировать текст" только если есть текст
    const copyBtn = document.getElementById('contextMenuCopy');
    if (copyBtn) {
        copyBtn.style.display = message.message ? 'flex' : 'none';
    }
}

// Позиционирование меню
function positionContextMenu(x, y) {
    if (!contextMenu) return;
    
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // На мобильных - снизу по центру
        contextMenu.style.left = '0';
        contextMenu.style.right = '0';
        contextMenu.style.top = 'auto';
        contextMenu.style.bottom = '0';
        contextMenu.style.transform = 'none';
    } else {
        // На десктопе - рядом с курсором
        const menuWidth = contextMenu.offsetWidth || 240;
        const menuHeight = contextMenu.offsetHeight || 400;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        let left = x;
        let top = y;
        
        // Проверяем, не выходит ли за правый край
        if (left + menuWidth > windowWidth) {
            left = windowWidth - menuWidth - 10;
        }
        
        // Проверяем, не выходит ли за нижний край
        if (top + menuHeight > windowHeight) {
            top = windowHeight - menuHeight - 10;
        }
        
        // Минимальные отступы от краев
        left = Math.max(10, left);
        top = Math.max(10, top);
        
        contextMenu.style.left = left + 'px';
        contextMenu.style.top = top + 'px';
        contextMenu.style.right = 'auto';
        contextMenu.style.bottom = 'auto';
        contextMenu.style.transform = 'none';
    }
}

// Закрытие контекстного меню
function closeContextMenu() {
    if (contextMenu) {
        contextMenu.classList.remove('show');
    }
    
    // Убираем выделение с сообщения
    document.querySelectorAll('.message-context-active').forEach(el => {
        el.classList.remove('message-context-active');
    });
    
    currentMessage = null;
    isLongPress = false;
}

// Обработка правого клика мыши (глобальная функция)
window.handleContextMenu = function(e, message, messageElement) {
    e.preventDefault();
    e.stopPropagation();
    
    showContextMenu(message, e.clientX, e.clientY, messageElement);
};

// Обработка долгого нажатия на мобильных (глобальная функция)
window.handleLongPressStart = function(e, message, messageElement) {
    isLongPress = false;
    if (longPressTimer) {
        clearTimeout(longPressTimer);
    }
    
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        // Вибрация (если поддерживается)
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
        
        const touch = e.touches && e.touches[0] ? e.touches[0] : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
        showContextMenu(message, touch.clientX, touch.clientY, messageElement);
    }, 500); // 500ms для долгого нажатия
};

window.handleLongPressEnd = function(e) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    
    // Если это было долгое нажатие, предотвращаем обычный клик
    if (isLongPress) {
        e.preventDefault();
        e.stopPropagation();
    }
};

// Переменные для управления функциями (глобальные)
window.replyToMessage = null;
window.selectedMessages = new Set();
window.editingMessageId = null;

// Обработчики действий меню
async function handleReply(message) {
    window.replyToMessage = message;
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.focus();
        messageInput.placeholder = `Ответить на: ${message.message ? (message.message.length > 30 ? message.message.substring(0, 30) + '...' : message.message) : '📷 Фото'}`;
        if (typeof showToast === 'function') {
            showToast('Введите ответ на сообщение');
        }
    }
}

async function handleEdit(message) {
    window.editingMessageId = message.id;
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.value = message.message || '';
        messageInput.focus();
        messageInput.placeholder = 'Редактировать сообщение...';
        if (typeof updateInputButtons === 'function') {
            updateInputButtons();
        }
        if (typeof showToast === 'function') {
            showToast('Редактируйте сообщение и нажмите Enter для сохранения');
        }
    }
}

async function handlePin(message) {
    try {
        const response = await fetch(`/api/messages/${message.id}/pin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof showToast === 'function') {
                showToast(data.is_pinned ? 'Сообщение закреплено' : 'Сообщение откреплено');
            }
            // Перезагружаем сообщения
            if (typeof currentChatUserId !== 'undefined' && currentChatUserId && typeof loadMessages === 'function') {
                await loadMessages(currentChatUserId, false);
            }
        } else {
            if (typeof showToast === 'function') {
                showToast('Ошибка: ' + (data.message || 'Неизвестная ошибка'));
            }
        }
    } catch (error) {
        console.error('Ошибка закрепления сообщения:', error);
        if (typeof showToast === 'function') {
            showToast('Ошибка соединения с сервером');
        }
    }
}

function handleCopy(message) {
    if (message.message) {
        navigator.clipboard.writeText(message.message).then(() => {
            if (typeof showToast === 'function') {
                showToast('Текст скопирован');
            }
        }).catch(() => {
            // Fallback для старых браузеров
            const textArea = document.createElement('textarea');
            textArea.value = message.message;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            if (typeof showToast === 'function') {
                showToast('Текст скопирован');
            }
        });
    } else if (message.image_path) {
        if (typeof showToast === 'function') {
            showToast('Изображение нельзя скопировать');
        }
    }
}

async function handleForward(message) {
    // Для упрощения пересылаем в текущий чат (можно улучшить позже)
    if (typeof currentChatUserId === 'undefined' || !currentChatUserId) {
        if (typeof showToast === 'function') {
            showToast('Выберите чат для пересылки');
        }
        return;
    }
    
    try {
        const response = await fetch(`/api/messages/${message.id}/forward`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                receiver_id: currentChatUserId
            })
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof showToast === 'function') {
                showToast('Сообщение переслано');
            }
            // Перезагружаем сообщения
            if (typeof loadMessages === 'function') {
                await loadMessages(currentChatUserId, true);
            }
        } else {
            if (typeof showToast === 'function') {
                showToast('Ошибка: ' + (data.message || 'Неизвестная ошибка'));
            }
        }
    } catch (error) {
        console.error('Ошибка пересылки сообщения:', error);
        if (typeof showToast === 'function') {
            showToast('Ошибка соединения с сервером');
        }
    }
}

function handleSelect(message) {
    const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
    if (messageElement) {
        if (window.selectedMessages.has(message.id)) {
            window.selectedMessages.delete(message.id);
            messageElement.classList.remove('message-selected');
        } else {
            window.selectedMessages.add(message.id);
            messageElement.classList.add('message-selected');
        }
        if (typeof showToast === 'function') {
            showToast(window.selectedMessages.size > 0 ? `Выбрано сообщений: ${window.selectedMessages.size}` : 'Выделение снято');
        }
    }
}

async function handleDelete(message) {
    if (confirm('Вы уверены, что хотите удалить это сообщение?')) {
        try {
            const response = await fetch(`/api/messages/${message.id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const data = await response.json();
            if (data.success) {
                if (typeof showToast === 'function') {
                    showToast('Сообщение удалено');
                }
                // Перезагружаем сообщения
                if (typeof currentChatUserId !== 'undefined' && currentChatUserId && typeof loadMessages === 'function') {
                    await loadMessages(currentChatUserId, false);
                }
                // Обновляем список чатов
                if (typeof silentLoadChats === 'function') {
                    await silentLoadChats();
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast('Ошибка: ' + (data.message || 'Неизвестная ошибка'));
                }
            }
        } catch (error) {
            console.error('Ошибка удаления сообщения:', error);
            if (typeof showToast === 'function') {
                showToast('Ошибка соединения с сервером');
            }
        }
    }
}


// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initContextMenu();
});
