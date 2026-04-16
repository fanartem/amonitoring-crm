import React, { useState, useEffect } from 'react';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Загружаем клиентов при открытии страницы
  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('http://127.0.0.1:8000/clients', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Не удалось загрузить список клиентов');
      }

      const data = await response.json();
      setClients(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="clients-wrapper">
      <div className="clients-header-row" style={{ marginBottom: '20px' }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>Клиенты</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span className="clients-hint">Клиенты из заявок и созданные вручную</span>
          <button className="emp-add-btn">+ Добавить клиента</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
          Загрузка клиентов...
        </div>
      ) : error ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#c53030' }}>
          {error}
        </div>
      ) : clients.length === 0 ? (
        <div className="dash-empty visible" style={{ display: 'block' }}>
          Нет клиентов
        </div>
      ) : (
        /* Сетка с карточками клиентов */
        <div className="clients-grid">
          {clients.map(client => (
            <div key={client.id} className="client-card">
              <div className="client-card-name">
                {client.company_name || client.name}
              </div>
              <div className="client-card-type">
                {client.type} {client.company_name ? ` · ${client.name}` : ''}
              </div>
              <div className="client-card-phone">
                {client.phone} {client.email ? ` · ${client.email}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}