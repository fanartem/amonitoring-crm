import React, { useState, useEffect } from 'react';
import '../styles/Requests.css'; // Используем те же стили модалок

export default function CreateClientModal({ isOpen, onClose, onCreated, editClientData }) {
  const isEditMode = !!editClientData;

  const [formData, setFormData] = useState({
    type: 'Физ. лицо',
    name: '',
    company_name: '',
    phone: '',
    email: ''
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (isEditMode) {
        // Подставляем данные для редактирования
        let uiType = 'Физ. лицо';
        if (editClientData.type === 'TOO' || editClientData.type === 'ТОО') uiType = 'ТОО';
        if (editClientData.type === 'IP' || editClientData.type === 'ИП') uiType = 'ИП';

        setFormData({
          type: uiType,
          name: editClientData.name || '',
          company_name: editClientData.company_name || '',
          phone: editClientData.phone || '',
          email: editClientData.email || ''
        });
      } else {
        // Очищаем форму для нового клиента
        setFormData({
          type: 'Физ. лицо',
          name: '',
          company_name: '',
          phone: '',
          email: ''
        });
      }
      setError('');
    }
  }, [isOpen, editClientData]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Валидация
    if (!formData.name || !formData.phone) {
      setError('Заполните обязательные поля: ФИО и Телефон');
      return;
    }

    if ((formData.type === 'ТОО' || formData.type === 'ИП') && !formData.company_name) {
      setError('Для ТОО и ИП необходимо указать наименование компании');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      
      let dbType = 'INDIVIDUAL';
      if (formData.type === 'ТОО') dbType = 'TOO';
      if (formData.type === 'ИП') dbType = 'IP';

      const payload = {
        type: dbType,
        name: formData.name,
        company_name: dbType === 'INDIVIDUAL' ? null : formData.company_name,
        phone: formData.phone,
        email: formData.email || null
      };

      const url = isEditMode 
        ? `http://127.0.0.1:8000/clients/${editClientData.id}` 
        : 'http://127.0.0.1:8000/clients';
      
      const method = isEditMode ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ошибка: ${errText}`);
      }

      onCreated(); // Закрываем модалку и обновляем список
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay open">
      <div className="modal-window" style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <div className="modal-title">{isEditMode ? 'Редактирование клиента' : 'Добавить нового клиента'}</div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        
        {error && <div className="validation-banner visible" style={{ background: '#ffebee', color: '#c62828', padding: '15px', borderBottom: '1px solid #ef9a9a' }}>{error}</div>}
        
        <div className="modal-body" style={{ background: '#f7f7f7', padding: '20px' }}>
          <form id="client-form" onSubmit={handleSubmit}>
            
            <div className="form-row align-center">
              <span className="field-label req-mark">Тип лица:</span>
              <select className="form-input" name="type" value={formData.type} onChange={handleChange}>
                <option>Физ. лицо</option>
                <option>ИП</option>
                <option>ТОО</option>
              </select>
            </div>

            {(formData.type === 'ТОО' || formData.type === 'ИП') && (
              <div className="form-row align-center">
                <span className="field-label req-mark">Наименование:</span>
                <input className="form-input" type="text" name="company_name" value={formData.company_name} onChange={handleChange} placeholder="Например: Ромашка" />
              </div>
            )}

            <div className="form-row align-center">
              <span className="field-label req-mark">ФИО:</span>
              <input className="form-input" type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Иванов Иван" />
            </div>
            
            <div className="form-row align-center">
              <span className="field-label req-mark">Телефон:</span>
              <input className="form-input" type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="+7 (777) 000-00-00" />
            </div>

            <div className="form-row align-center">
              <span className="field-label">Email:</span>
              <input className="form-input" type="email" name="email" value={formData.email} onChange={handleChange} placeholder="example@mail.ru" />
            </div>

          </form>
        </div>
        
        <div className="modal-footer">
          <button className="modal-submit-btn" type="button" onClick={onClose} style={{ borderColor: '#aaa', color: '#888' }}>Отмена</button>
          <button className="modal-submit-btn" type="submit" form="client-form" disabled={loading}>
            {loading ? 'Сохранение...' : isEditMode ? 'Сохранить изменения' : 'Добавить клиента'}
          </button>
        </div>
      </div>
    </div>
  );
}