import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api';

export default function Clients() {
  // 1. Получаем данные с бэкенда
  const { data: clients, isLoading, isError } = useQuery({
    queryKey: ['clients'], // Уникальный ключ кэша для этого запроса
    queryFn: () => api.get('/clients').then(res => res.data), // Запрос к FastAPI
  });

  // 2. Обрабатываем промежуточные состояния
  if (isLoading) return <div style={{ padding: 40, textAlign: 'center' }}>Загрузка клиентов...</div>;
  if (isError) return <div style={{ padding: 40, color: 'red', textAlign: 'center' }}>Ошибка при загрузке клиентов.</div>;

  // 3. Рендерим интерфейс, используя твои классы из App.css
  return (
    <div className="section-inner" style={{ margin: '40px auto' }}>
      <h2 className="section-title">База клиентов</h2>

      <div className="placeholder-table">
        {/* Шапка таблицы (Grid-сетка из App.css) */}
        <div className="table-row table-header">
          <div>Имя / Компания</div>
          <div>Телефон</div>
          <div>Email</div>
          <div>Статус</div>
        </div>

        {/* Пробегаемся по массиву клиентов и отрисовываем строку для каждого */}
        {clients?.map((client) => (
          <div key={client.id} className="table-row">
            <div style={{ fontWeight: 600, color: '#333' }}>{client.name}</div>
            <div>{client.phone}</div>
            <div>{client.email}</div>
            <div>
              {/* Условный рендеринг классов для бейджа */}
              <span className={`badge ${client.is_active ? 'active-badge' : 'inactive-badge'}`}>
                {client.is_active ? 'Активен' : 'Неактивен'}
              </span>
            </div>
          </div>
        ))}

        {/* Сообщение, если база пустая */}
        {(!clients || clients.length === 0) && (
          <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>
            Список клиентов пуст
          </div>
        )}
      </div>
    </div>
  );
}