import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Clients from './components/Clients';
import Approvals from './components/Approvals';
import Home from './components/Home';

// Импортируем наши компоненты
import Entrance from './components/Entrance';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Requests from './components/Requests'; // <-- Подключили нашу новую таблицу заявок!




export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Проверяем наличие токена при первой загрузке приложения
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      setIsAuthenticated(true);
    }
    setIsLoading(false); // Заканчиваем загрузку
  }, []);

  if (isLoading) return null; // Убираем моргание экрана при загрузке

  // Если пользователь НЕ авторизован — показываем только экран входа
  if (!isAuthenticated) {
    return <Entrance />;
  }

  // Если авторизован — рендерим полный интерфейс CRM
  return (
    <div className="crm-app">
      {/* Шапка */}
      <Header />

      <div className="body-row">
        {/* Боковое меню */}
        <Sidebar />

        {/* Основной контент */}
        <main className="main">
          <section className="content-section active" style={{ display: 'block', overflowY: 'auto', width: '100%' }}>
            
            {/* РЕГИСТРАТОР ПУТЕЙ */}
            <Routes>
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/" element={<Home />} />
              <Route path="/clients" element={<Clients />} />
              
              {/* ВОТ ОН! Наш новый роут для заявок */}
              <Route path="/requests" element={<Requests />} /> 
              
              <Route path="/employees" element={<div style={{ padding: '20px' }}><h2>Сотрудники</h2></div>} />
              <Route path="/settings" element={<div style={{ padding: '20px' }}><h2>Настройки</h2></div>} />
              
              {/* Если ввели неизвестный адрес — кидаем на главную */}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>

          </section>
        </main>
      </div>
    </div>
  );
}