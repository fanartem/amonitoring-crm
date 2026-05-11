import React, { useState, useEffect } from 'react';
import '../styles/Requests.css';
import CreateRequestModal from './CreateRequestModal';
import RequestDetailModal from './RequestDetailModal';

const getUserRole = () => {
  try {
    const token = localStorage.getItem('access_token');
    if (!token) return null;
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload).role;
  } catch (error) {
    return null;
  }
};

export default function Requests() {
  const [requests, setRequests] = useState([]);
  const [filteredRequests, setFilteredRequests] = useState([]);
  const [technicians, setTechnicians] = useState([]); 
  
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [editRequestData, setEditRequestData] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [detailModalTab, setDetailModalTab] = useState('info');

  const [filters, setFilters] = useState({ search: '', status: '', city: '', format: '' });
  const userRole = getUserRole();

  useEffect(() => {
    fetchRequests();
    fetchTechnicians();
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const fetchRequests = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('http://127.0.0.1:8000/requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
        setFilteredRequests(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки заявок:', err);
    }
  };

  const fetchTechnicians = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('http://127.0.0.1:8000/users/technicians', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setTechnicians(await res.json());
    } catch (err) { console.error(err); }
  };

  const getTechName = (techId) => {
    if (!techId) return null;
    const tech = technicians.find(t => t.id === techId);
    return tech ? tech.name : `ID: ${techId}`;
  };

  useEffect(() => {
    let result = requests;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(r => 
        (r.client_name && r.client_name.toLowerCase().includes(s)) || 
        (r.company_name && r.company_name.toLowerCase().includes(s)) ||
        (r.phone && r.phone.toLowerCase().includes(s)) ||
        (r.plate_number && r.plate_number.toLowerCase().includes(s)) ||
        (r.vin && r.vin.toLowerCase().includes(s)) ||
        (r.brand && r.brand.toLowerCase().includes(s)) ||
        (r.model && r.model.toLowerCase().includes(s))
      );
    }
    if (filters.status) result = result.filter(r => r.status === filters.status);
    if (filters.format) result = result.filter(r => r.visit_type === filters.format);
    if (filters.city) result = result.filter(r => r.city === filters.city);
    setFilteredRequests(result);
  }, [filters, requests]);

  const handleFilterChange = (e) => setFilters({ ...filters, [e.target.name]: e.target.value });
  const resetFilters = () => setFilters({ search: '', status: '', city: '', format: '' });

  const statusLabels = { 'NEW': 'В ожидании', 'IN_PROGRESS': 'В процессе установки', 'DONE': 'Работы завершены', 'CANCELLED': 'Отменено', 'COMPLETED': 'Работы завершены' };
  const statusClasses = { 'NEW': 'status-new', 'IN_PROGRESS': 'status-progress', 'DONE': 'status-done', 'COMPLETED': 'status-done', 'CANCELLED': 'status-cancelled' };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
  };

  const toggleDropdown = (e, reqId) => {
    e.stopPropagation(); 
    setActiveDropdown(prev => prev === reqId ? null : reqId);
  };

  // ФУНКЦИЯ УДАЛЕНИЯ ИЗ ТРЁХ ТОЧЕК
  const handleDeleteRequest = async (e, reqId) => {
    e.stopPropagation();
    setActiveDropdown(null);
    if (!window.confirm('Вы уверены, что хотите удалить эту заявку? Она будет перемещена в Корзину.')) return;

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/requests/${reqId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        alert('Заявка удалена!');
        fetchRequests();
      } else {
        const errData = await res.text();
        throw new Error(errData || 'Ошибка при удалении заявки');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleMenuOpen = (e, reqId) => {
    e.stopPropagation();
    setActiveDropdown(null);
    setDetailModalTab('info');
    setSelectedRequestId(reqId);
  };

  const handleMenuEdit = (e, req) => {
    e.stopPropagation();
    setActiveDropdown(null);
    setEditRequestData(req);
    setCreateModalOpen(true);
  };

  const handleMenuDownload = (e, reqId) => {
    e.stopPropagation();
    setActiveDropdown(null);
    alert(`Загрузка заявки №${reqId}...`);
  };

  const handleMenuHistory = (e, reqId) => {
    e.stopPropagation();
    setActiveDropdown(null);
    setDetailModalTab('history');
    setSelectedRequestId(reqId);
  };

  const handleOpenEditFromDetail = (reqData) => {
    setSelectedRequestId(null);
    setEditRequestData(reqData);
    setCreateModalOpen(true);
  };

  return (
    <div className="requests-page-container">
      <div className="filters-bar">
        <div className="filter-group" style={{ flex: '1.5' }}>
          <label>Глобальный поиск</label>
          <input className="filter-input" type="text" name="search" placeholder="ФИО, Телефон, Гос.номер, VIN, Марка..." value={filters.search} onChange={handleFilterChange} style={{ minWidth: '250px' }} />
        </div>
        <div className="filter-group"><label>Статус</label><select className="filter-select" name="status" value={filters.status} onChange={handleFilterChange}><option value="">Все статусы</option><option value="NEW">В ожидании</option><option value="IN_PROGRESS">В процессе установки</option><option value="COMPLETED">Работы завершены</option></select></div>
        <div className="filter-group"><label>Город</label><select className="filter-select" name="city" value={filters.city} onChange={handleFilterChange}><option value="">Все города</option><option value="Алматы">Алматы</option><option value="Астана">Астана</option><option value="Шымкент">Шымкент</option></select></div>
        <div className="filter-group"><label>Формат работы</label><select className="filter-select" name="format" value={filters.format} onChange={handleFilterChange}><option value="">Все форматы</option><option value="ON_SITE">Выезд к клиенту</option><option value="IN_OFFICE">В офисе</option></select></div>
        <button className="btn-reset" onClick={resetFilters}>Сбросить</button>
      </div>

      <div className="requests-list">
        {filteredRequests.map(req => (
          <div key={req.id} className="request-card" style={{ zIndex: activeDropdown === req.id ? 100 : 1, position: 'relative', cursor: 'default' }}>
            <div className="card-column">
              <div className="card-item"><span className="card-label">Клиент</span><span className="card-value">{req.client_name || 'Не указано'}</span></div>
              <div className="card-item"><span className="card-label">Статус</span><div className={`status-badge ${statusClasses[req.status] || 'status-new'}`}>{statusLabels[req.status] || req.status}</div></div>
              {req.assigned_to && (
                <div className="card-item" style={{ marginTop: '5px' }}>
                  <span className="card-label">Исполнитель</span>
                  <span className="card-value" style={{ fontWeight: '600', color: '#5e9424', fontSize: '13px' }}>{getTechName(req.assigned_to)}</span>
                </div>
              )}
            </div>

            <div className="card-column">
              <div className="card-item"><span className="card-label">Авто</span><span className="card-value">{req.brand} {req.model} <span style={{color: '#888', fontSize: '12px'}}>({req.plate_number || 'б/н'})</span></span></div>
              <div className="card-item"><span className="card-label">Город</span><span className="card-value">{req.city || 'Не указан'}</span></div>
            </div>

            <div className="card-column">
              <div className="card-item">
                <span className="card-label">Оборудование</span>
                <span className="card-value" style={{fontSize: '13px'}}>
                  {req.work_type === 'INSTALLATION' ? `${req.has_blocking ? 'Блок.' : 'Без блок.'} • ${req.has_beacon ? 'Маяк' : 'Без маяка'}` : <span style={{ color: '#aaa' }}>—</span>}
                </span>
              </div>
              <div className="card-item"><span className="card-label">Формат</span><span className="card-value">{req.visit_type === 'ON_SITE' ? 'Выезд к клиенту' : 'В офисе'}</span></div>
            </div>

            <div className="card-column">
              <div className="card-item"><span className="card-label">Дата</span><span className="card-value">{formatDate(req.created_at)}</span></div>
              <div className="card-item">
                <span className="card-label">Оплата</span>
                <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                  <div className={`status-badge ${req.is_paid ? 'status-progress' : 'status-new'}`} style={{padding: '2px 10px', fontSize: '11px'}}>{req.is_paid ? 'Оплачено' : 'Ожидает оплаты'}</div>
                  {req.is_paid && req.paid_at && <span style={{ fontSize: '11px', color: '#888', fontWeight: '500' }}>{formatDate(req.paid_at).split(' ')[0]}</span>}
                </div>
              </div>
            </div>

            <div className="card-actions-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'absolute', top: '15px', right: '15px' }}>
              <button className="btn-details" onClick={(e) => { e.stopPropagation(); setDetailModalTab('info'); setSelectedRequestId(req.id); }}>Детали</button>
              <div className="card-actions" onClick={(e) => toggleDropdown(e, req.id)}>&#8942;</div>
              
              {activeDropdown === req.id && (
                <div className="dropdown-menu">
                  <div className="dropdown-item" onClick={(e) => handleMenuOpen(e, req.id)}><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 4h8v2H8v-2z"/></svg> Открыть</div>
                  {userRole !== 'TECHNICIAN' && (
                    <div className="dropdown-item" onClick={(e) => handleMenuEdit(e, req)}><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg> Редактировать</div>
                  )}
                  <div className="dropdown-item" onClick={(e) => handleMenuDownload(e, req.id)}><svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Скачать заявку</div>
                  <div className="dropdown-divider"></div>
                  <div className="dropdown-item" onClick={(e) => handleMenuHistory(e, req.id)}><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg> История изменений</div>
                  
                  {/* НОВОЕ: Кнопка удаления в трёх точках */}
                  {userRole === 'ADMIN' && (
                    <>
                      <div className="dropdown-divider"></div>
                      <div className="dropdown-item" style={{ color: '#c62828' }} onClick={(e) => handleDeleteRequest(e, req.id)}>
                        <svg viewBox="0 0 24 24" fill="#c62828"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> Удалить заявку
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
        <div className="create-btn-container"><button className="btn-create-floating" onClick={() => setCreateModalOpen(true)}>Создать заявку</button></div>
      )}

      <CreateRequestModal isOpen={isCreateModalOpen} editRequestData={editRequestData} onClose={() => { setCreateModalOpen(false); setEditRequestData(null); }} onCreated={() => { setCreateModalOpen(false); setEditRequestData(null); fetchRequests(); }} />
      <RequestDetailModal isOpen={!!selectedRequestId} requestId={selectedRequestId} initialTab={detailModalTab} onClose={() => setSelectedRequestId(null)} onUpdated={() => fetchRequests()} onEditClick={handleOpenEditFromDetail} />
    </div>
  );
}