import React, { useState, useEffect, useRef } from 'react';
import '../styles/Requests.css'; // Используем классы из заявок для унификации дизайна
import '../styles/Warehouse.css'
import WarehouseItemModal from './WarehouseItemModal';

const CATEGORIES = {
  GPS_TRACKER: 'Трекер', BEACON: 'Маяк', FUEL_SENSOR: 'ДУТ', BLE_SENSOR: 'BLE-датчик',
  WIRED_SENSOR: 'Пров. датчик', RELAY: 'Реле', CABLE: 'Кабель', OTHER: 'Другое'
};

const STATUSES = { IN_STOCK: 'На складе', RESERVED: 'Резерв', INSTALLED: 'Установлено', WRITTEN_OFF: 'Списано' };
const STATUS_COLORS = { IN_STOCK: '#5e9424', RESERVED: '#f57c00', INSTALLED: '#1976d2', WRITTEN_OFF: '#c62828' };

export default function Warehouse() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ search: '', category: '', status: '' });
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchItems();
  }, [filters]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      // Собираем query-параметры
      const params = new URLSearchParams();
      if (filters.category) params.append('category', filters.category);
      if (filters.status) params.append('status', filters.status);
      if (filters.search) params.append('search', filters.search);

      const res = await fetch(`http://127.0.0.1:8000/warehouse/items?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setItems(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (e) => setFilters({ ...filters, [e.target.name]: e.target.value });
  const resetFilters = () => setFilters({ search: '', category: '', status: '' });

  const handleDelete = async (id) => {
    if (!window.confirm('Переместить оборудование в корзину?')) return;
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`http://127.0.0.1:8000/warehouse/items/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail);
      }
      fetchItems();
    } catch (err) {
      alert(err.message);
    }
  };

  // ИМПОРТ CSV
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('http://127.0.0.1:8000/warehouse/import', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData // Fetch сам поставит правильный Content-Type для FormData
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Ошибка импорта');
      
	  setImportResult(buildImportMessage(data));
      fetchItems();
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    } finally {
      e.target.value = ''; // Сброс инпута
    }
  };

  const buildImportMessage = data => {
		const lines = []

		lines.push(`Добавлено: ${data.imported_count || 0}`)

		const errors = data.errors || []

		if (errors.length > 0) {
			lines.push('Пропущено:')

			errors.forEach(err => {
				if (err.identifier_type && err.identifier_value) {
					lines.push(`${err.identifier_type}: ${err.identifier_value}`)
				} else if (err.row && err.error) {
					lines.push(`Строка ${err.row}: ${err.error}`)
				} else if (err.error) {
					lines.push(err.error)
				}
			})
		}

		return lines.join('\n')
	}
  
  // СКАЧАТЬ ШАБЛОН CSV
  const downloadTemplate = async () => {
    const token = localStorage.getItem('access_token');
    const res = await fetch('http://127.0.0.1:8000/warehouse/template', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'warehouse_template.csv';
      a.click();
    }
  };

  const openEdit = (item) => {
    setEditItem(item);
    setIsModalOpen(true);
  };

  return (
		<div className='requests-page-container'>
			<div className='clients-header-bar' style={{ marginBottom: '15px' }}>
				<h2>Склад оборудования</h2>
				<div style={{ display: 'flex', gap: '10px' }}>
					<button
						onClick={downloadTemplate}
						style={{
							padding: '8px 12px',
							background: '#f5f5f5',
							border: '1px solid #ddd',
							borderRadius: '6px',
							cursor: 'pointer',
						}}
					>
						Шаблон CSV
					</button>
					<input
						type='file'
						accept='.csv'
						ref={fileInputRef}
						style={{ display: 'none' }}
						onChange={handleFileUpload}
					/>
					<button
						onClick={() => fileInputRef.current.click()}
						style={{
							padding: '8px 12px',
							background: '#e3f2fd',
							color: '#1565c0',
							border: '1px solid #bbdefb',
							borderRadius: '6px',
							cursor: 'pointer',
						}}
					>
						Импорт CSV
					</button>
					<button
						className='btn-green'
						onClick={() => {
							setEditItem(null)
							setIsModalOpen(true)
						}}
					>
						+ Добавить
					</button>
				</div>
			</div>

			<div className='filters-bar' style={{ marginBottom: '20px' }}>
				<div className='filter-group' style={{ flex: '1.5' }}>
					<label>Поиск по складу</label>
					<input
						className='filter-input'
						type='text'
						name='search'
						placeholder='Наименование, модель, IMEI...'
						value={filters.search}
						onChange={handleFilterChange}
					/>
				</div>
				<div className='filter-group'>
					<label>Категория</label>
					<select
						className='filter-select'
						name='category'
						value={filters.category}
						onChange={handleFilterChange}
					>
						<option value=''>Все категории</option>
						{Object.entries(CATEGORIES).map(([k, v]) => (
							<option key={k} value={k}>
								{v}
							</option>
						))}
					</select>
				</div>
				<div className='filter-group'>
					<label>Статус</label>
					<select
						className='filter-select'
						name='status'
						value={filters.status}
						onChange={handleFilterChange}
					>
						<option value=''>Все статусы</option>
						{Object.entries(STATUSES).map(([k, v]) => (
							<option key={k} value={k}>
								{v}
							</option>
						))}
					</select>
				</div>
				<button className='btn-reset' onClick={resetFilters}>
					Сбросить
				</button>
			</div>

			<div
				style={{
					background: '#fff',
					borderRadius: '8px',
					border: '1px solid #eee',
					overflow: 'hidden',
				}}
			>
				<table
					style={{
						width: '100%',
						borderCollapse: 'collapse',
						fontSize: '14px',
						textAlign: 'left',
					}}
				>
					<thead>
						<tr
							style={{
								background: '#f9f9f9',
								borderBottom: '2px solid #eee',
								color: '#555',
							}}
						>
							<th style={{ padding: '12px 15px' }}>Наименование</th>
							<th style={{ padding: '12px 15px' }}>Категория</th>
							<th style={{ padding: '12px 15px' }}>Идентификатор</th>
							<th style={{ padding: '12px 15px' }}>Кол-во</th>
							<th style={{ padding: '12px 15px' }}>Статус</th>
							<th style={{ padding: '12px 15px', textAlign: 'right' }}>
								Действия
							</th>
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr>
								<td
									colSpan='6'
									style={{ padding: '20px', textAlign: 'center' }}
								>
									Загрузка...
								</td>
							</tr>
						) : items.length === 0 ? (
							<tr>
								<td
									colSpan='6'
									style={{
										padding: '20px',
										textAlign: 'center',
										color: '#888',
									}}
								>
									Оборудование не найдено
								</td>
							</tr>
						) : (
							items.map(item => (
								<tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
									<td style={{ padding: '12px 15px' }}>
										<strong>{item.name}</strong>
										{item.model && (
											<div style={{ fontSize: '12px', color: '#888' }}>
												{item.manufacturer} {item.model}
											</div>
										)}
									</td>
									<td style={{ padding: '12px 15px' }}>
										{CATEGORIES[item.category] || item.category}
									</td>
									<td style={{ padding: '12px 15px' }}>
										{item.is_serialized ? (
											<>
												<span style={{ color: '#888', fontSize: '11px' }}>
													{item.identifier_type}:
												</span>{' '}
												{item.identifier_value}
											</>
										) : (
											<span style={{ color: '#aaa', fontSize: '12px' }}>
												Расходник
											</span>
										)}
									</td>
									<td style={{ padding: '12px 15px', fontWeight: 'bold' }}>
										{item.quantity} шт.
									</td>
									<td style={{ padding: '12px 15px' }}>
										<span
											style={{
												background: STATUS_COLORS[item.status] || '#888',
												color: '#fff',
												padding: '2px 8px',
												borderRadius: '12px',
												fontSize: '11px',
												fontWeight: 'bold',
											}}
										>
											{STATUSES[item.status] || item.status}
										</span>
									</td>
									<td style={{ padding: '12px 15px', textAlign: 'right' }}>
										<div className='warehouse-actions'>
											<button
												className='warehouse-action-btn warehouse-edit-btn'
												onClick={() => openEdit(item)}
												title='Редактировать'
											>
												✎
											</button>

											<button
												className='warehouse-action-btn warehouse-delete-btn'
												onClick={() => handleDelete(item.id)}
												title='Переместить в корзину'
											>
												🗑
											</button>
										</div>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			<WarehouseItemModal
				isOpen={isModalOpen}
				editItem={editItem}
				onClose={() => {
					setIsModalOpen(false)
					setEditItem(null)
				}}
				onSaved={() => {
					setIsModalOpen(false)
					setEditItem(null)
					fetchItems()
				}}
			/>

			{importResult && (
				<div
					className='modal-overlay open'
					onClick={() => setImportResult(null)}
				>
					<div
						className='modal-window import-result-modal'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Результат импорта</span>
							<button
								className='modal-close'
								type='button'
								onClick={() => setImportResult(null)}
							>
								&times;
							</button>
						</div>

						<div className='import-result-body'>
							<textarea
								className='import-result-textarea'
								value={importResult}
								readOnly
							/>

							<div className='import-result-hint'>
								Список можно скопировать и использовать для проверки пропущенных
								устройств.
							</div>
						</div>

						<div className='modal-footer import-result-footer'>
							<button
								className='modal-cancel-btn'
								type='button'
								onClick={() => setImportResult(null)}
							>
								Закрыть
							</button>

							<button
								className='warehouse-submit-btn'
								type='button'
								onClick={() => navigator.clipboard.writeText(importResult)}
							>
								Скопировать
							</button>
						</div>
					</div>
				</div>
			)}
			
		</div>
	)
}