// Управление профилем пользователя
let currentProfile = null;
let isEditing = false;

// Загрузка профиля
async function loadProfile() {
    try {
        const response = await fetch('/api/profile');
        const data = await response.json();
        
        if (data.success) {
            currentProfile = data.profile;
            displayProfile(data.profile);
        } else {
            console.error('Ошибка загрузки профиля:', data.message);
            if (typeof showToast === 'function') {
                showToast(data.message || 'Ошибка загрузки профиля');
            } else {
                alert(data.message || 'Ошибка загрузки профиля');
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки профиля:', error);
        if (typeof showToast === 'function') {
            showToast('Ошибка соединения при загрузке профиля');
        } else {
            alert('Ошибка соединения при загрузке профиля');
        }
    }
}

// Отображение профиля
function displayProfile(profile) {
    const avatar = document.getElementById('profileAvatar');
    const avatarText = document.getElementById('profileAvatarText');
    const avatarImage = document.getElementById('profileAvatarImage');
    const username = document.getElementById('profileUsername');
    const usernameInput = document.getElementById('profileUsernameInput');
    const phoneId = document.getElementById('profilePhoneId');
    
    // Аватарка
    if (avatarImage) {
        if (profile.avatar_path) {
            avatarImage.src = `/uploads/${profile.avatar_path}`;
            avatarImage.style.display = 'block';
            if (avatarText) avatarText.style.display = 'none';
        } else {
            avatarImage.style.display = 'none';
            // Плейсхолдер (последние две цифры номера)
            if (profile.phone && profile.phone.length >= 2) {
                const phoneDigits = profile.phone.slice(-2);
                avatarText.textContent = phoneDigits;
            } else {
                avatarText.textContent = '--';
            }
            avatarText.style.display = 'block';
        }
    } else if (avatarText) {
        // Фоллбек, если по какой-то причине нет img
        if (profile.phone && profile.phone.length >= 2) {
            const phoneDigits = profile.phone.slice(-2);
            avatarText.textContent = phoneDigits;
        } else {
            avatarText.textContent = '--';
        }
    }
    
    // Ник
    const displayUsername = profile.username || 'Не указан';
    username.textContent = displayUsername;
    usernameInput.value = profile.username || '';
    
    // Номер телефона с ID
    const phoneIdText = profile.phone ? `${profile.phone}@${profile.user_id || '--'}` : '--@--';
    phoneId.textContent = phoneIdText;
}

// Открытие модального окна профиля
function openProfileModal() {
    const modal = document.getElementById('profileModal');
    modal.classList.add('show');
    loadProfile();
    isEditing = false;
    updateEditMode();
}

// Закрытие модального окна профиля
function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    modal.classList.remove('show');
    isEditing = false;
    updateEditMode();
    // Восстанавливаем исходные значения
    if (currentProfile) {
        displayProfile(currentProfile);
    }
}

// Переключение режима редактирования
function toggleEditMode() {
    isEditing = !isEditing;
    updateEditMode();
}

// Обновление UI в зависимости от режима редактирования
function updateEditMode() {
    const username = document.getElementById('profileUsername');
    const usernameInput = document.getElementById('profileUsernameInput');
    const actions = document.getElementById('profileActions');
    
    if (isEditing) {
        username.style.display = 'none';
        usernameInput.style.display = 'block';
        actions.style.display = 'flex';
        usernameInput.focus();
    } else {
        username.style.display = 'block';
        usernameInput.style.display = 'none';
        actions.style.display = 'none';
    }
}

// Сохранение профиля
async function saveProfile() {
    const usernameInput = document.getElementById('profileUsernameInput');
    const username = usernameInput.value.trim();
    
    try {
        const response = await fetch('/api/profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentProfile = data.profile;
            displayProfile(data.profile);
            isEditing = false;
            updateEditMode();
            showToast('Профиль обновлен');
        } else {
            alert('Ошибка обновления профиля: ' + (data.message || 'Неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Ошибка сохранения профиля:', error);
        alert('Ошибка соединения с сервером');
    }
}

// Отмена редактирования
function cancelEdit() {
    isEditing = false;
    updateEditMode();
    // Восстанавливаем исходные значения
    if (currentProfile) {
        displayProfile(currentProfile);
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    // Кнопка открытия профиля в меню
    const profileMenuItem = document.getElementById('profileMenuItem');
    if (profileMenuItem) {
        profileMenuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            const menuDropdown = document.getElementById('menuDropdown');
            if (menuDropdown) {
                menuDropdown.classList.remove('show');
            }
            openProfileModal();
        });
    }
    
    // Кнопка редактирования
    const profileEditBtn = document.getElementById('profileEditBtn');
    if (profileEditBtn) {
        profileEditBtn.addEventListener('click', toggleEditMode);
    }
    
    // Кнопка закрытия
    const profileCloseBtn = document.getElementById('profileCloseBtn');
    if (profileCloseBtn) {
        profileCloseBtn.addEventListener('click', closeProfileModal);
    }
    
    // Закрытие по клику на backdrop
    const profileModalBackdrop = document.getElementById('profileModalBackdrop');
    if (profileModalBackdrop) {
        profileModalBackdrop.addEventListener('click', closeProfileModal);
    }
    
    // Кнопка сохранения
    const profileSaveBtn = document.getElementById('profileSaveBtn');
    if (profileSaveBtn) {
        profileSaveBtn.addEventListener('click', saveProfile);
    }
    
    // Кнопка отмены
    const profileCancelBtn = document.getElementById('profileCancelBtn');
    if (profileCancelBtn) {
        profileCancelBtn.addEventListener('click', cancelEdit);
    }

    // Смена аватарки
    const profileAvatar = document.getElementById('profileAvatar');
    const profileAvatarFile = document.getElementById('profileAvatarFile');
    if (profileAvatar && profileAvatarFile) {
        profileAvatar.addEventListener('click', () => {
            profileAvatarFile.click();
        });

        profileAvatarFile.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                alert('Пожалуйста, выберите изображение');
                return;
            }

            const formData = new FormData();
            formData.append('avatar', file);

            try {
                const response = await fetch('/api/profile/avatar', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                if (data.success) {
                    if (data.profile) {
                        currentProfile = data.profile;
                        displayProfile(data.profile);
                    }
                    if (typeof showToast === 'function') {
                        showToast('Аватар обновлен');
                    }
                } else {
                    alert(data.message || 'Не удалось обновить аватар');
                }
            } catch (error) {
                console.error('Ошибка обновления аватара:', error);
                alert('Ошибка соединения с сервером');
            } finally {
                // Сбрасываем input, чтобы одно и то же файл можно было выбрать снова
                profileAvatarFile.value = '';
            }
        });
    }
    
    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('profileModal');
            if (modal && modal.classList.contains('show')) {
                if (isEditing) {
                    cancelEdit();
                } else {
                    closeProfileModal();
                }
            }
        }
    });
    
    // Сохранение по Enter в поле ввода ника
    const usernameInput = document.getElementById('profileUsernameInput');
    if (usernameInput) {
        usernameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveProfile();
            }
        });
    }
});
