import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  const userDataStr = localStorage.getItem('user_data');
  const user = userDataStr ? JSON.parse(userDataStr) : null;
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_data');
    window.location.href = '/login';
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
          Главная
        </NavLink>
        
        <NavLink to="/clients" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Клиенты
        </NavLink>
        
        <NavLink to="/requests" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Заявки
        </NavLink>
        
        {/* Блок, который показывается только Администратору */}
        {isAdmin && (
          <>
            <NavLink to="/employees" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              Сотрудники
            </NavLink>
            <NavLink to="/approvals" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              Одобрение
            </NavLink>
          </>
        )}
      </div>

      <div className="sidebar-bottom">
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          Настройки
        </NavLink>
        
        <div className="nav-item" onClick={handleLogout} style={{ cursor: 'pointer' }}>
          Выход
        </div>
      </div>
    </nav>
  );
}