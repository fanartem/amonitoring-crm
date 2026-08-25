import React, { useState, useEffect, useMemo } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
import '../styles/Approvals.css'

const DEFAULT_ROLE_COLOR = '#64748B'

const normalizeHexColor = value => {
	const color = String(value || '').trim()
	return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_ROLE_COLOR
}

const hexToRgba = (hexColor, alpha = 0.14) => {
	const color = normalizeHexColor(hexColor).replace('#', '')
	const r = parseInt(color.slice(0, 2), 16)
	const g = parseInt(color.slice(2, 4), 16)
	const b = parseInt(color.slice(4, 6), 16)

	return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const getRoleBadgeStyle = role => {
	const color = normalizeHexColor(role?.badge_color || role?.role_badge_color)

	return {
		backgroundColor: hexToRgba(color, 0.16),
		color,
		borderColor: hexToRgba(color, 0.35),
	}
}

export default function Approvals() {
	const [pendingUsers, setPendingUsers] = useState([])
	const [roleOptions, setRoleOptions] = useState([])
	const [loading, setLoading] = useState(true)
	const [rolesLoading, setRolesLoading] = useState(false)
	const [error, setError] = useState('')

	useEffect(() => {
		fetchPendingUsers()
		fetchRoleOptions()
	}, [])

	const roleMap = useMemo(() => {
		const map = new Map()

		roleOptions.forEach(role => {
			map.set(role.code, role)
		})

		return map
	}, [roleOptions])

	const fetchPendingUsers = async () => {
		setLoading(true)
		setError('')

		try {
			const response = await fetch(`${API_BASE_URL}/admin/pending-users`, {
				headers: getAuthHeaders(),
			})

			if (!response.ok) {
				const data = await response.json().catch(() => null)
				throw new Error(
					data?.detail || 'Не удалось загрузить список заявок на регистрацию',
				)
			}

			const data = await response.json()
			setPendingUsers(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const fetchRoleOptions = async () => {
		setRolesLoading(true)

		try {
			// Берём тот же публичный справочник, что и форма регистрации.
			// Так Approvals не зависит от hardcode и видит новые роли.
			const response = await fetch(`${API_BASE_URL}/auth/registration-roles`)

			if (!response.ok) {
				throw new Error('Не удалось загрузить список ролей')
			}

			const data = await response.json()
			setRoleOptions(Array.isArray(data) ? data : [])
		} catch (err) {
			console.error('Ошибка загрузки ролей:', err)
			setRoleOptions([])
		} finally {
			setRolesLoading(false)
		}
	}

	const getUserRoleMeta = user => {
		const roleFromBackend = roleMap.get(user.role)

		return {
			code: user.role,
			name:
				user.role_name ||
				roleFromBackend?.name ||
				user.role ||
				'Роль не указана',
			badge_color:
				user.role_badge_color ||
				roleFromBackend?.badge_color ||
				DEFAULT_ROLE_COLOR,
			can_be_request_executor:
				user.can_be_request_executor ??
				roleFromBackend?.can_be_request_executor ??
				false,
			can_be_responsible_manager:
				user.can_be_responsible_manager ??
				roleFromBackend?.can_be_responsible_manager ??
				false,
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
				const data = await response.json().catch(() => null)
				throw new Error(data?.detail || 'Ошибка при одобрении сотрудника')
			}

			setPendingUsers(prev => prev.filter(user => user.id !== userId))
		} catch (err) {
			alert(err.message)
		}
	}

	const handleReject = async userId => {
		const confirmed = window.confirm(
			'Вы уверены, что хотите отклонить заявку этого сотрудника?',
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
				const data = await response.json().catch(() => null)
				throw new Error(data?.detail || 'Ошибка при отклонении заявки')
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

			{rolesLoading && (
				<div className='approvals-info'>Обновляем справочник ролей...</div>
			)}

			{loading ? (
				<div className='approvals-loading'>Загрузка...</div>
			) : error ? (
				<div className='approvals-error'>{error}</div>
			) : pendingUsers.length === 0 ? (
				<div className='empty-approvals'>Нет заявок на регистрацию</div>
			) : (
				<div className='approvals-grid'>
					{pendingUsers.map(user => {
						const roleMeta = getUserRoleMeta(user)

						return (
							<div key={user.id} className='approval-card'>
								<div className='approval-info'>
									<div className='approval-name'>
										{user.name || 'Без имени'}
									</div>

									<div className='approval-email'>{user.email}</div>

									{user.city && (
										<div className='approval-city'>📍 {user.city}</div>
									)}

									<div
										className='approval-role role-badge dynamic-role-badge'
										style={getRoleBadgeStyle(roleMeta)}
										title={roleMeta.code}
									>
										{roleMeta.name}
									</div>

									<div className='approval-role-flags'>
										{roleMeta.can_be_request_executor && (
											<span className='approval-role-flag'>
												Исполнитель заявок
											</span>
										)}

										{roleMeta.can_be_responsible_manager && (
											<span className='approval-role-flag'>
												Ответственный менеджер
											</span>
										)}
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
						)
					})}
				</div>
			)}
		</div>
	)
}
