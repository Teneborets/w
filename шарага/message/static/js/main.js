// Форматирование номера телефона
function formatPhone(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length > 0) {
        if (value.length <= 1) {
            value = '+' + value;
        } else if (value.length <= 4) {
            value = '+' + value.substring(0, 1) + ' (' + value.substring(1);
        } else if (value.length <= 7) {
            value = '+' + value.substring(0, 1) + ' (' + value.substring(1, 4) + ') ' + value.substring(4);
        } else if (value.length <= 9) {
            value = '+' + value.substring(0, 1) + ' (' + value.substring(1, 4) + ') ' + value.substring(4, 7) + '-' + value.substring(7);
        } else {
            value = '+' + value.substring(0, 1) + ' (' + value.substring(1, 4) + ') ' + value.substring(4, 7) + '-' + value.substring(7, 9) + '-' + value.substring(9, 11);
        }
    }
    input.value = value;
}

// Получение только цифр из номера телефона
function getPhoneDigits(phone) {
    return phone.replace(/\D/g, '');
}

// Показ ошибки
function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
    setTimeout(() => {
        element.style.display = 'none';
    }, 5000);
}

// Обработка формы регистрации
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', function() {
            formatPhone(this);
        });
    }

    registerForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const errorMessage = document.getElementById('errorMessage');
        const submitButton = registerForm.querySelector('button[type="submit"]');
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const phone = getPhoneDigits(document.getElementById('phone').value);
        
        // Валидация имени пользователя
        if (!username) {
            showError(errorMessage, 'Имя пользователя обязательно');
            return;
        }
        
        if (username.length < 3) {
            showError(errorMessage, 'Имя пользователя должно содержать минимум 3 символа');
            return;
        }
        
        if (username.length > 30) {
            showError(errorMessage, 'Имя пользователя не может быть длиннее 30 символов');
            return;
        }
        
        if (username.includes(' ')) {
            showError(errorMessage, 'Имя пользователя не должно содержать пробелы');
            return;
        }
        
        // Валидация паролей
        if (password !== confirmPassword) {
            showError(errorMessage, 'Пароли не совпадают');
            return;
        }
        
        if (password.length < 6) {
            showError(errorMessage, 'Пароль должен содержать минимум 6 символов');
            return;
        }
        
        // Отправка данных
        submitButton.disabled = true;
        submitButton.classList.add('loading');
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    phone: phone,
                    password: password
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                window.location.href = data.redirect || '/dashboard';
            } else {
                showError(errorMessage, data.message || 'Ошибка регистрации');
                submitButton.disabled = false;
                submitButton.classList.remove('loading');
            }
        } catch (error) {
            showError(errorMessage, 'Ошибка соединения с сервером');
            submitButton.disabled = false;
            submitButton.classList.remove('loading');
        }
    });
}

// Обработка формы авторизации
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', function() {
            formatPhone(this);
        });
    }

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const errorMessage = document.getElementById('errorMessage');
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const phone = getPhoneDigits(document.getElementById('phone').value);
        const password = document.getElementById('password').value;
        
        // Отправка данных
        submitButton.disabled = true;
        submitButton.classList.add('loading');
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    phone: phone,
                    password: password
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                window.location.href = data.redirect || '/dashboard';
            } else {
                showError(errorMessage, data.message || 'Неверный номер телефона или пароль');
                submitButton.disabled = false;
                submitButton.classList.remove('loading');
            }
        } catch (error) {
            showError(errorMessage, 'Ошибка соединения с сервером');
            submitButton.disabled = false;
            submitButton.classList.remove('loading');
        }
    });
}

// Обработка выхода
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async function() {
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
