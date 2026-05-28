import React, { useEffect, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Settings.css'

const getUserRole = () => {
	try {
		const token = localStorage.getItem('access_token')
		if (!token) return null

		const base64Url = token.split('.')[1]
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
				.join(''),
		)

		return JSON.parse(jsonPayload).role
	} catch {
		return null
	}
}

export default function Settings() {
	const [cities, setCities] = useState([])
	const [newCityName, setNewCityName] = useState('')
	const [editingCityId, setEditingCityId] = useState(null)
	const [editingCityName, setEditingCityName] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [notificationSettings, setNotificationSettings] = useState([])
	const [notificationLoading, setNotificationLoading] = useState(false)
	const [notificationError, setNotificationError] = useState('')

	const userRole = getUserRole()
	const isAdmin = userRole === 'ADMIN'
	const isWarehouseManager = userRole === 'WAREHOUSE_MANAGER'

	const canViewWarehouseNotifications = isAdmin || isWarehouseManager

	useEffect(() => {
		fetchNotificationSettings()

		if (isAdmin) {
			fetchCities()
		}
	}, [isAdmin])

	const fetchNotificationSettings = async () => {
		setNotificationLoading(true)
		setNotificationError('')

		try {
			const res = await fetch(`${API_BASE_URL}/notifications/settings`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Не удалось загрузить настройки уведомлений',
				)
			}

			const data = await res.json()
			setNotificationSettings(Array.isArray(data) ? data : [])
		} catch (err) {
			setNotificationError(err.message)
		} finally {
			setNotificationLoading(false)
		}
	}

	const handleToggleNotification = async typeCode => {
		const nextSettings = notificationSettings.map(setting =>
			setting.type_code === typeCode
				? {
						...setting,
						is_enabled: !setting.is_enabled,
					}
				: setting,
		)

		setNotificationSettings(nextSettings)

		try {
			const changedSetting = nextSettings.find(
				setting => setting.type_code === typeCode,
			)

			const res = await fetch(`${API_BASE_URL}/notifications/settings`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					settings: [
						{
							type_code: changedSetting.type_code,
							is_enabled: changedSetting.is_enabled,
						},
					],
				}),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Не удалось обновить настройки уведомлений',
				)
			}
		} catch (err) {
			setNotificationError(err.message)
			fetchNotificationSettings()
		}
	}

	const fetchCities = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(`${API_BASE_URL}/cities?active_only=false`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить города')
			}

			const data = await res.json()
			setCities(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleCreateCity = async e => {
		e.preventDefault()

		const name = newCityName.trim()

		if (!name) {
			setError('Введите название города')
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/cities`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ name }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось добавить город')
			}

			setNewCityName('')
			fetchCities()
		} catch (err) {
			setError(err.message)
		}
	}

	const startEditCity = city => {
		setEditingCityId(city.id)
		setEditingCityName(city.name)
		setError('')
	}

	const cancelEditCity = () => {
		setEditingCityId(null)
		setEditingCityName('')
	}

	const handleUpdateCity = async cityId => {
		const name = editingCityName.trim()

		if (!name) {
			setError('Название города не может быть пустым')
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/cities/${cityId}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ name }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось обновить город')
			}

			cancelEditCity()
			fetchCities()
		} catch (err) {
			setError(err.message)
		}
	}

	const handleToggleCity = async city => {
		const nextActive = !city.is_active

		const confirmText = nextActive
			? `Включить город "${city.name}"?`
			: `Отключить город "${city.name}"? Он перестанет отображаться во всех формах выбора городов.`

		if (!window.confirm(confirmText)) return

		try {
			const res = await fetch(`${API_BASE_URL}/cities/${city.id}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ is_active: nextActive }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось изменить статус города')
			}

			fetchCities()
		} catch (err) {
			setError(err.message)
		}
	}

	const visibleNotificationSettings = notificationSettings.filter(item => {
		if (item.category === 'WAREHOUSE') {
			return canViewWarehouseNotifications
		}

		return true
	})

	const groupedNotificationSettings = visibleNotificationSettings.reduce(
		(acc, item) => {
			const category = item.category || 'GENERAL'

			if (!acc[category]) {
				acc[category] = []
			}

			acc[category].push(item)

			return acc
		},
		{},
	)

	const notificationCategoryLabels = {
		REQUESTS: 'Заявки',
		FINANCE: 'Финансы',
		WAREHOUSE: 'Склад',
		GENERAL: 'Общие',
	}

	return (
		<div className='settings-page'>
			<div className='settings-header'>
				<h2>Настройки</h2>
				<p>Управление системными параметрами CRM.</p>
			</div>

			<div className='settings-card'>
				<div className='settings-card-header'>
					<div>
						<h3>Уведомления</h3>
						<p>Выберите, какие уведомления вы хотите получать в CRM.</p>
					</div>
				</div>

				{notificationError && (
					<div className='settings-error'>{notificationError}</div>
				)}

				{notificationLoading ? (
					<div className='settings-empty'>Загрузка уведомлений...</div>
				) : visibleNotificationSettings.length === 0 ? (
					<div className='settings-empty'>Настройки уведомлений не найдены</div>
				) : (
					<div className='settings-notifications-list'>
						{Object.entries(groupedNotificationSettings).map(
							([category, items]) => (
								<div key={category} className='settings-notification-group'>
									<div className='settings-notification-group-title'>
										{notificationCategoryLabels[category] || category}
									</div>

									{items.map(item => (
										<label
											key={item.type_code}
											className='settings-notification-row'
										>
											<div>
												<div className='settings-notification-name'>
													{item.name}
												</div>
												{item.description && (
													<div className='settings-notification-description'>
														{item.description}
													</div>
												)}
											</div>

											<input
												type='checkbox'
												checked={Boolean(item.is_enabled)}
												onChange={() =>
													handleToggleNotification(item.type_code)
												}
											/>
										</label>
									))}
								</div>
							),
						)}
					</div>
				)}
			</div>

			{isAdmin && (
				<div className='settings-card'>
					<div className='settings-card-header'>
						<div>
							<h3>Города</h3>
							<p>
								Список городов используется в заявках, сотрудниках и фильтрах.
							</p>
						</div>
					</div>

					{error && <div className='settings-error'>{error}</div>}

					<form className='settings-add-row' onSubmit={handleCreateCity}>
						<input
							type='text'
							value={newCityName}
							onChange={e => setNewCityName(e.target.value)}
							placeholder='Название города'
							className='settings-input'
						/>

						<button type='submit' className='settings-primary-btn'>
							+ Добавить город
						</button>
					</form>

					{loading ? (
						<div className='settings-empty'>Загрузка...</div>
					) : cities.length === 0 ? (
						<div className='settings-empty'>Города пока не добавлены</div>
					) : (
						<div className='settings-table-wrap'>
							<table className='settings-table'>
								<thead>
									<tr>
										<th>Город</th>
										<th>Статус</th>
										<th>Дата создания</th>
										<th style={{ textAlign: 'right' }}>Действия</th>
									</tr>
								</thead>

								<tbody>
									{cities.map(city => (
										<tr key={city.id}>
											<td>
												{editingCityId === city.id ? (
													<input
														className='settings-input settings-table-input'
														value={editingCityName}
														onChange={e => setEditingCityName(e.target.value)}
													/>
												) : (
													<strong>{city.name}</strong>
												)}
											</td>

											<td>
												<span
													className={`settings-status ${city.is_active ? 'active' : 'inactive'}`}
												>
													{city.is_active ? 'Активен' : 'Отключён'}
												</span>
											</td>

											<td>
												{city.created_at
													? new Date(city.created_at).toLocaleDateString(
															'ru-RU',
														)
													: '—'}
											</td>

											<td>
												<div className='settings-actions'>
													{editingCityId === city.id ? (
														<>
															<button
																type='button'
																className='settings-save-btn'
																onClick={() => handleUpdateCity(city.id)}
															>
																Сохранить
															</button>

															<button
																type='button'
																className='settings-cancel-btn'
																onClick={cancelEditCity}
															>
																Отмена
															</button>
														</>
													) : (
														<>
															<button
																type='button'
																className='settings-edit-btn'
																onClick={() => startEditCity(city)}
															>
																Редактировать
															</button>

															<button
																type='button'
																className={
																	city.is_active
																		? 'settings-disable-btn'
																		: 'settings-enable-btn'
																}
																onClick={() => handleToggleCity(city)}
															>
																{city.is_active ? 'Отключить' : 'Включить'}
															</button>
														</>
													)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
