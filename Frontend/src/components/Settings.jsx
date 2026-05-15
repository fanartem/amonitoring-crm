import React, { useEffect, useState } from 'react'
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

	const userRole = getUserRole()
	const isAdmin = userRole === 'ADMIN'

	useEffect(() => {
		if (isAdmin) {
			fetchCities()
		}
	}, [isAdmin])

	const fetchCities = async () => {
		setLoading(true)
		setError('')

		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch(
				'http://127.0.0.1:8000/cities?active_only=false',
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				},
			)

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
			const token = localStorage.getItem('access_token')

			const res = await fetch('http://127.0.0.1:8000/cities', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
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
			const token = localStorage.getItem('access_token')

			const res = await fetch(`http://127.0.0.1:8000/cities/${cityId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
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
			const token = localStorage.getItem('access_token')

			const res = await fetch(`http://127.0.0.1:8000/cities/${city.id}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
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

	return (
		<div className='settings-page'>
			<div className='settings-header'>
				<h2>Настройки</h2>
				<p>Управление системными параметрами CRM.</p>
			</div>

			{!isAdmin ? (
				<div className='settings-card'>
					<div className='settings-empty'>
						Настройки доступны только администратору.
					</div>
				</div>
			) : (
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
