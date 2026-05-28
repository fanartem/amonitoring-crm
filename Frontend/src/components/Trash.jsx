import React, { useState, useEffect } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
import '../styles/Requests.css'
import '../styles/Clients.css'

export default function Trash() {
  const [activeTab, setActiveTab] = useState('requests')
	const [deletedRequests, setDeletedRequests] = useState([])
	const [deletedClients, setDeletedClients] = useState([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	useEffect(() => {
		fetchTrashData()
	}, [])

	const fetchTrashData = async () => {
		setLoading(true)
		setError('')

		try {
			const headers = getAuthHeaders()

			const [reqRes, cliRes] = await Promise.all([
				fetch(`${API_BASE_URL}/requests/deleted`, { headers }),
				fetch(`${API_BASE_URL}/clients/deleted`, { headers }),
			])

			if (!reqRes.ok || !cliRes.ok) {
				throw new Error('Не удалось загрузить данные корзины')
			}

			setDeletedRequests(await reqRes.json())
			setDeletedClients(await cliRes.json())
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleRestoreRequest = async id => {
		try {
			const res = await fetch(`${API_BASE_URL}/requests/${id}/restore`, {
				method: 'PATCH',
				headers: getAuthHeaders(),
			})

			if (!res.ok) throw new Error('Ошибка при восстановлении заявки')

			alert('Заявка успешно восстановлена!')
			fetchTrashData()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleRestoreClient = async id => {
		try {
			const res = await fetch(`${API_BASE_URL}/clients/${id}/restore`, {
				method: 'PATCH',
				headers: getAuthHeaders(),
			})

			if (!res.ok) throw new Error('Ошибка при восстановлении клиента')

			alert('Клиент успешно восстановлен!')
			fetchTrashData()
		} catch (err) {
			alert(err.message)
		}
	}

	const formatDate = dateString => {
		if (!dateString) return '—'
		const d = new Date(dateString)
		return (
			d.toLocaleDateString('ru-RU') +
			' ' +
			d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
		)
	}

	return (
		<div className='requests-page-container' style={{ padding: '20px' }}>
			<div className='clients-header-bar' style={{ marginBottom: '20px' }}>
				<h2>Корзина</h2>
				<span className='subtitle-text'>Восстановление удаленных данных</span>
			</div>

			<div
				className='custom-tabs'
				style={{ marginBottom: '20px', justifyContent: 'flex-start' }}
			>
				<button
					className={`custom-tab ${activeTab === 'requests' ? 'active' : ''}`}
					onClick={() => setActiveTab('requests')}
				>
					Удаленные заявки{' '}
					<span className='tab-badge'>{deletedRequests.length}</span>
				</button>
				<button
					className={`custom-tab ${activeTab === 'clients' ? 'active' : ''}`}
					onClick={() => setActiveTab('clients')}
				>
					Удаленные клиенты{' '}
					<span className='tab-badge'>{deletedClients.length}</span>
				</button>
			</div>

			{error && (
				<div
					style={{
						color: '#c62828',
						marginBottom: '15px',
						background: '#ffebee',
						padding: '10px',
						borderRadius: '4px',
					}}
				>
					{error}
				</div>
			)}

			{loading ? (
				<div style={{ color: '#888', padding: '20px' }}>
					Загрузка корзины...
				</div>
			) : (
				<div className='trash-content'>
					{/* Вкладка: Заявки */}
					{activeTab === 'requests' && (
						<div className='requests-list'>
							{deletedRequests.length === 0 ? (
								<div style={{ color: '#888', padding: '20px' }}>
									Корзина заявок пуста
								</div>
							) : null}
							{deletedRequests.map(req => (
								<div
									key={req.id}
									className='request-card'
									style={{ opacity: 0.85, background: '#fefefe' }}
								>
									<div className='card-column'>
										<div className='card-item'>
											<span className='card-label'>Удаленная заявка</span>
											<span
												className='card-value'
												style={{
													textDecoration: 'line-through',
													color: '#888',
												}}
											>
												{req.client_name || 'Неизвестный клиент'}
											</span>
										</div>
										<div className='card-item'>
											<span className='card-label'>Авто</span>
											<span className='card-value'>
												{req.brand} {req.model} ({req.plate_number})
											</span>
										</div>
									</div>
									<div className='card-column'>
										<div className='card-item'>
											<span className='card-label'>Дата удаления</span>
											<span
												className='card-value'
												style={{ color: '#c62828', fontWeight: '500' }}
											>
												{formatDate(req.deleted_at)}
											</span>
										</div>
									</div>
									<div
										className='card-actions-wrapper'
										style={{ position: 'absolute', right: '15px', top: '15px' }}
									>
										<button
											className='btn-green'
											onClick={() => handleRestoreRequest(req.id)}
										>
											Восстановить
										</button>
									</div>
								</div>
							))}
						</div>
					)}

					{/* Вкладка: Клиенты */}
					{activeTab === 'clients' && (
						<div className='clients-grid'>
							{deletedClients.length === 0 ? (
								<div style={{ color: '#888', padding: '20px' }}>
									Корзина клиентов пуста
								</div>
							) : null}
							{deletedClients.map(client => (
								<div
									key={client.id}
									className='client-card'
									style={{
										opacity: 0.85,
										position: 'relative',
										background: '#fefefe',
									}}
								>
									<div
										className='client-card-title'
										style={{ textDecoration: 'line-through', color: '#888' }}
									>
										{client.company_name || client.name}
									</div>
									<div className='client-card-type'>{client.type}</div>
									<div
										className='client-card-info'
										style={{ marginTop: '10px' }}
									>
										Удален:{' '}
										<span style={{ color: '#c62828', fontWeight: '500' }}>
											{formatDate(client.deleted_at)}
										</span>
									</div>
									<div style={{ marginTop: '15px' }}>
										<button
											className='btn-green'
											style={{ width: '100%' }}
											onClick={() => handleRestoreClient(client.id)}
										>
											Восстановить
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
