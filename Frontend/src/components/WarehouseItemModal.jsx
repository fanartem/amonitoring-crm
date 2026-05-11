import React, { useState, useEffect } from 'react';
import '../styles/Requests.css'; // Используем те же стили модалок

const CATEGORIES = {
  GPS_TRACKER: 'GPS-трекер',
  BEACON: 'Маяк',
  FUEL_SENSOR: 'Датчик уровня топлива (ДУТ)',
  BLE_SENSOR: 'BLE-датчик',
  WIRED_SENSOR: 'Проводной датчик',
  RELAY: 'Реле',
  CABLE: 'Кабель',
  OTHER: 'Другое'
};

const IDENTIFIER_TYPES = ['IMEI', 'MAC', 'SERIAL', 'NONE', 'OTHER'];
const STATUSES = { IN_STOCK: 'На складе', RESERVED: 'Резерв', INSTALLED: 'Установлено', WRITTEN_OFF: 'Списано' };

export default function WarehouseItemModal({ isOpen, onClose, onSaved, editItem }) {
  const isEditMode = !!editItem;

  const [formData, setFormData] = useState({
    category: 'GPS_TRACKER',
    name: '',
    manufacturer: '',
    model: '',
    identifier_type: 'IMEI',
    identifier_value: '',
    serial_number: '',
    is_serialized: true,
    quantity: 1,
    note: '',
    status: 'IN_STOCK'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (isEditMode) {
        setFormData({
          category: editItem.category || 'GPS_TRACKER',
          name: editItem.name || '',
          manufacturer: editItem.manufacturer || '',
          model: editItem.model || '',
          identifier_type: editItem.identifier_type || 'IMEI',
          identifier_value: editItem.identifier_value || '',
          serial_number: editItem.serial_number || '',
          is_serialized: editItem.is_serialized,
          quantity: editItem.quantity || 1,
          note: editItem.note || '',
          status: editItem.status || 'IN_STOCK'
        });
      } else {
        setFormData({
          category: 'GPS_TRACKER', name: '', manufacturer: '', model: '',
          identifier_type: 'IMEI', identifier_value: '', serial_number: '',
          is_serialized: true, quantity: 1, note: '', status: 'IN_STOCK'
        });
      }
      setError('');
    }
  }, [isOpen, editItem]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    let newVal = type === 'checkbox' ? checked : value;

    // Умная логика формы
    if (name === 'is_serialized') {
      if (newVal) {
        // Если серийный -> кол-во = 1, тип ID = IMEI
        setFormData({ ...formData, is_serialized: true, quantity: 1, identifier_type: 'IMEI' });
      } else {
        // Если НЕ серийный (расходник) -> тип ID = NONE, стираем ID
        setFormData({ ...formData, is_serialized: false, identifier_type: 'NONE', identifier_value: '' });
      }
      return;
    }

    setFormData({ ...formData, [name]: newVal });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.name) {
      setError('Наименование оборудования обязательно');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      
      const payload = {
        category: formData.category,
        name: formData.name,
        manufacturer: formData.manufacturer || null,
        model: formData.model || null,
        identifier_type: formData.identifier_type,
        identifier_value: formData.identifier_value || null,
        serial_number: formData.serial_number || null,
        is_serialized: formData.is_serialized,
        quantity: parseInt(formData.quantity, 10),
        note: formData.note || null,
        ...(isEditMode && { status: formData.status }) // Статус передаем только при редактировании
      };

      const url = isEditMode ? `http://127.0.0.1:8000/warehouse/items/${editItem.id}` : 'http://127.0.0.1:8000/warehouse/items';
      const method = isEditMode ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Ошибка сохранения');
      }

      onSaved(); 
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay open">
      <div className="modal-window" style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <span className="modal-title">{isEditMode ? 'Редактировать оборудование' : 'Добавить на склад'}</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {error && <div className="validation-banner visible" style={{ background: '#ffebee', color: '#c62828', padding: '15px' }}>{error}</div>}

        <div className="modal-body" style={{ background: '#f7f7f7', padding: '20px' }}>
          <form id="warehouse-form" onSubmit={handleSubmit}>
            
            <div className="form-row align-center">
              <span className="field-label req-mark">Категория:</span>
              <select className="form-input" name="category" value={formData.category} onChange={handleChange}>
                {Object.entries(CATEGORIES).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div className="form-row align-center">
              <span className="field-label req-mark">Наименование:</span>
              <input className="form-input" type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Teltonika FMC920..." />
            </div>

            <div className="form-row align-center">
              <span className="field-label">Производитель:</span>
              <input className="form-input" type="text" name="manufacturer" value={formData.manufacturer} onChange={handleChange} />
            </div>

            <div className="form-row align-center">
              <span className="field-label">Модель:</span>
              <input className="form-input" type="text" name="model" value={formData.model} onChange={handleChange} />
            </div>

            <div className="form-row align-center" style={{ marginTop: '15px', padding: '10px', background: '#e3f2fd', borderRadius: '6px' }}>
              <label className="radio-label" style={{ fontWeight: 'bold', color: '#1565c0' }}>
                <input type="checkbox" name="is_serialized" checked={formData.is_serialized} onChange={handleChange} />
                Серийное (Уникальное) оборудование
              </label>
              <div style={{ fontSize: '11px', color: '#555', marginLeft: '25px', marginTop: '4px' }}>Снимите галочку, если это расходник (кабель, стяжки), измеряемый количеством.</div>
            </div>

            {formData.is_serialized ? (
              <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '6px', marginTop: '10px', background: '#fff' }}>
                <div className="form-row align-center">
                  <span className="field-label req-mark">Тип ID:</span>
                  <select className="form-input" name="identifier_type" value={formData.identifier_type} onChange={handleChange}>
                    {IDENTIFIER_TYPES.filter(t => t !== 'NONE').map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-row align-center">
                  <span className="field-label req-mark">Значение ID:</span>
                  <input className="form-input" type="text" name="identifier_value" value={formData.identifier_value} onChange={handleChange} placeholder="Номер IMEI / MAC" />
                </div>
                <div className="form-row align-center">
                  <span className="field-label">Кол-во:</span>
                  <input className="form-input" type="number" value="1" disabled style={{ background: '#eee' }} />
                </div>
              </div>
            ) : (
              <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '6px', marginTop: '10px', background: '#fff' }}>
                <div className="form-row align-center">
                  <span className="field-label req-mark">Количество:</span>
                  <input className="form-input" type="number" name="quantity" value={formData.quantity} onChange={handleChange} min="1" />
                </div>
              </div>
            )}

            {isEditMode && (
              <div className="form-row align-center" style={{ marginTop: '15px' }}>
                <span className="field-label req-mark">Статус:</span>
                <select className="form-input" name="status" value={formData.status} onChange={handleChange}>
                  {Object.entries(STATUSES).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-section" style={{ marginTop: '15px' }}>
              <span className="field-label">Примечание:</span>
              <textarea className="form-textarea full-width" name="note" rows="2" value={formData.note} onChange={handleChange} placeholder="Дополнительная информация..."></textarea>
            </div>

          </form>
        </div>

        <div className="modal-footer">
          <button className="modal-submit-btn" type="button" onClick={onClose} style={{ borderColor: '#aaa', color: '#888' }}>Отмена</button>
          <button className="modal-submit-btn" type="submit" form="warehouse-form" disabled={loading}>
            {loading ? 'Сохранение...' : isEditMode ? 'Сохранить изменения' : 'Добавить на склад'}
          </button>
        </div>

      </div>
    </div>
  );
}