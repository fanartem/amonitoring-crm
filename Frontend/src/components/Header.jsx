import React from 'react';
// 1. ИМПОРТИРУЕМ КАРТИНКУ (убедись, что путь и расширение .png/.svg правильные)
import logoImg from '../assets/logo.png'; 

export default function Header() {
  const userDataStr = localStorage.getItem('user_data');
  const user = userDataStr ? JSON.parse(userDataStr) : null;

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_data');
    window.location.href = '/login'; 
  };

  return (
    <header className="header">
      <div className="logo">
        {/* 2. ВСТАВЛЯЕМ ПЕРЕМЕННУЮ В src */}
        <img src={logoImg} alt="Amonitoring" />
      </div>
      
      {/* ... дальше весь остальной код без изменений ... */}
      
      <div className="header-right">
        
        {/* 2. СТРОКА ПОИСКА (Возвращаем на место) */}
        <div className="search-wrap">
          <input type="text" placeholder="Поиск" />
          <span className="search-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
        </div>

        {/* 3. ПРОФИЛЬ / ВХОД */}
        {user ? (
          // === ЕСЛИ АВТОРИЗОВАН (Круглая иконка как на 1-м скрине) ===
          <>
            <button className="notif-btn" title={user.name} style={{ marginLeft: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </button>
            <button 
              onClick={handleLogout} 
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '500', marginLeft: '5px' }}
            >
              Выход
            </button>
          </>
        ) : (
          // === ЕСЛИ НЕ АВТОРИЗОВАН (Стильная полупрозрачная кнопка) ===
          <button 
            onClick={() => window.location.href = '/login'}
            style={{
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.4)',
              padding: '6px 16px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              marginLeft: '12px',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.target.style.background = 'rgba(255,255,255,0.3)'}
            onMouseOut={(e) => e.target.style.background = 'rgba(255,255,255,0.2)'}
          >
            Войти
          </button>
        )}
      </div>
    </header>
  );
}