import React, { useState, useEffect } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
import '../styles/Approvals.css'

export default function Approvals() {
	const [pendingUsers, setPendingUsers] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	const roleLabels = {
		ADMIN: 'Администратор',
		MANAGER: 'Менеджер',
		SENIOR_TECHNICIAN: 'Старший монтажник',
		TECHNICIAN: 'Монтажник',
		ACCOUNTANT: 'Бухгалтер',
		WAREHOUSE_MANAGER: 'Заведующий складом',
	}

	const roleClasses = {
		ADMIN: 'role-admin',
		MANAGER: 'role-manager',
		SENIOR_TECHNICIAN: 'role-senior',
		TECHNICIAN: 'role-tech',
		ACCOUNTANT: 'role-accountant',
		WAREHOUSE_MANAGER: 'role-warehouse',
	}

	useEffect(() => {
		fetchPendingUsers()
	}, [])

	const fetchPendingUsers = async () => {
		setLoading(true)
		setError('')

		try {
			const response = await fetch(`${API_BASE_URL}/admin/pending-users`, {
				headers: getAuthHeaders(),
			})

			if (!response.ok) {
				throw new Error('Не удалось загрузить список заявок на регистрацию')
			}

			const data = await response.json()
			setPendingUsers(data)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleApprove = async userId => {
		try {
			const response = await fetch(
				`${API_BASE_URL}/admin/approve-user/${userId}`,
				{
					method: 'POST',
					headers: getAuthHeaders(),
				},
			)

			if (!response.ok) {
				throw new Error('Ошибка при одобрении сотрудника')
			}

			setPendingUsers(prev => prev.filter(user => user.id !== userId))
		} catch (err) {
			alert(err.message)
		}
	}

	const handleReject = async userId => {
		const confirmed = window.confirm(
			'Вы уверены, что хотите отклонить и удалить этого сотрудника?',
		)

		if (!confirmed) return

		try {
			const response = await fetch(
				`${API_BASE_URL}/admin/reject-user/${userId}`,
				{
					method: 'DELETE',
					headers: getAuthHeaders(),
				},
			)

			if (!response.ok) {
				throw new Error('Ошибка при отклонении заявки')
			}

			setPendingUsers(prev => prev.filter(user => user.id !== userId))
		} catch (err) {
			alert(err.message)
		}
	}

	const formatDate = date => {
		if (!date) return 'Дата не указана'

		try {
			return new Date(date).toLocaleDateString('ru-RU', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
			})
		} catch {
			return date
		}
	}

	return (
		<div className='approvals-container'>
			<div className='approvals-header'>
				<h2>Одобрение сотрудников</h2>
				<p>
					Пользователи, зарегистрировавшиеся самостоятельно и ожидающие
					одобрения.
				</p>
			</div>

			{loading ? (
				<div className='approvals-loading'>Загрузка...</div>
			) : error ? (
				<div className='approvals-error'>{error}</div>
			) : pendingUsers.length === 0 ? (
				<div className='empty-approvals'>Нет заявок на регистрацию</div>
			) : (
				<div className='approvals-grid'>
					{pendingUsers.map(user => (
						<div key={user.id} className='approval-card'>
							<div className='approval-info'>
								<div className='approval-name'>{user.name || 'Без имени'}</div>
								<div className='approval-email'>{user.email}</div>

								{/* НОВОЕ: Вывод города, если пользователь его указал */}
								{user.city && (
									<div
										style={{
											fontSize: '13px',
											color: '#666',
											marginTop: '4px',
											marginBottom: '8px',
											fontWeight: '500',
										}}
									>
										📍 {user.city}
									</div>
								)}

								<div
									className={`approval-role role-badge ${roleClasses[user.role] || 'role-tech'}`}
									style={{ marginTop: user.city ? '0' : '8px' }}
								>
									{roleLabels[user.role] || user.role}
								</div>

								<div className='approval-date'>
									Зарегистрирован: {formatDate(user.created_at)}
								</div>
							</div>

							<div className='approval-actions'>
								<button
									className='btn-approve'
									onClick={() => handleApprove(user.id)}
								>
									Одобрить
								</button>

								<button
									className='btn-reject'
									onClick={() => handleReject(user.id)}
								>
									Отклонить
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
