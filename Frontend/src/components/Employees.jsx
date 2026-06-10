import React, { useState, useEffect } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Employees.css'

export default function Employees() {
	const [employees, setEmployees] = useState([])
	const [cities, setCities] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [selectedUser, setSelectedUser] = useState(null)
	const [formData, setFormData] = useState({
		email: '',
		name: '',
		password: '',
		role: '',
		city: '', // Добавили поле города в состояние формы
	})

	const currentUser =
		JSON.parse(localStorage.getItem('user_data') || 'null') || {}

	const getTokenPayload = () => {
		const token = localStorage.getItem('access_token')
		if (!token) return {}

		try {
			return JSON.parse(atob(token.split('.')[1]))
		} catch {
			return {}
		}
	}

	const tokenPayload = getTokenPayload()

	const currentUserId = Number(tokenPayload.sub)
	const currentUserRole = tokenPayload.role || null
	const isAdmin = currentUserRole === 'ADMIN'
	const isEditingSelf = selectedUser && Number(selectedUser.id) === currentUserId
	const canEditIdentityFields = isAdmin

	const isCurrentUser = emp => {
		return Number(emp.id) === currentUserId
	}

	useEffect(() => {
		fetchEmployees()
		fetchCities()
	}, [])

	const fetchEmployees = async () => {
		setLoading(true)

		try {
			const res = await fetch(`${API_BASE_URL}/admin/users`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) throw new Error('Не удалось загрузить сотрудников')

			const data = await res.json()
			setEmployees(data)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const fetchCities = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/cities`)

			if (res.ok) {
				const data = await res.json()
				setCities(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки городов:', err)
		}
	}
	
	const handleDelete = async (id, name) => {
		if (!window.confirm(`Удалить сотрудника ${name}?`)) return

		try {
			const response = await fetch(`${API_BASE_URL}/admin/users/${id}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			if (!response.ok) {
				const data = await response.json()
				throw new Error(data.detail || 'Ошибка удаления')
			}

			setEmployees(prev => prev.filter(emp => emp.id !== id))
		} catch (err) {
			alert(err.message)
		}
	}

	const handleEdit = emp => {
		setSelectedUser(emp)
		setFormData({
			email: emp.email || '',
			name: emp.name || '',
			password: '',
			role: emp.role || '',
			city: emp.city || '', // Подтягиваем город при редактировании
		})
		setIsModalOpen(true)
	}

	const handleChange = e => {
		const { name, value } = e.target
		setFormData(prev => ({
			...prev,
			[name]: value,
		}))
	}

	const handleSave = async () => {
		try {
			const body = {}

			if (isAdmin) {
				body.email = formData.email
				body.name = formData.name
				body.role = formData.role
				body.city = formData.city || null
			}

			if (formData.password) {
				body.password = formData.password
			}

			if (Object.keys(body).length === 0) {
				alert('Нет данных для сохранения')
				return
			}

			const response = await fetch(
				`${API_BASE_URL}/admin/users/${selectedUser.id}`,
				{
					method: 'PUT',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(body),
				},
			)

			if (!response.ok) {
				const data = await response.json()
				throw new Error(data.detail || 'Ошибка обновления')
			}

			// обновляем список
			setEmployees(prev =>
				prev.map(emp =>
					emp.id === selectedUser.id ? { ...emp, ...body } : emp,
				),
			)

			setIsModalOpen(false)
		} catch (err) {
			alert(err.message)
		}
	}

	const sortedEmployees = [...employees]
		.filter(emp => emp.email !== 'admin@amonitoring.kz')
		.sort((a, b) => {
			if (isCurrentUser(a)) return -1
			if (isCurrentUser(b)) return 1
			return 0
		})

	// Словари для бейджиков
	const roleLabels = {
		ADMIN: 'Администратор',
		ROP: 'РОП',
		MANAGER: 'Менеджер',
		TECH_SUPPORT: 'Тех. поддержка',
		SENIOR_TECHNICIAN: 'Старший монтажник',
		TECHNICIAN: 'Монтажник',
		ACCOUNTANT: 'Бухгалтер',
		WAREHOUSE_MANAGER: 'Заведующий складом',
	}

	const roleClasses = {
		ADMIN: 'role-admin',
		ROP: 'role-rop',
		MANAGER: 'role-manager',
		TECH_SUPPORT: 'role-support',
		SENIOR_TECHNICIAN: 'role-senior',
		TECHNICIAN: 'role-tech',
		ACCOUNTANT: 'role-accountant',
		WAREHOUSE_MANAGER: 'role-warehouse',
	}

	return (
		<div className='employees-page'>
			<div className='employees-header'>
				<h2>Сотрудники</h2>
			</div>
			<p className='employees-subtitle'>
				Сотрудники входят с логином и паролем.
			</p>

			{error && (
				<div style={{ color: 'red', marginBottom: '20px' }}>{error}</div>
			)}

			{loading ? (
				<div>Загрузка...</div>
			) : (
				<div className='employees-grid'>
					{sortedEmployees.map(emp => (
						<div
							key={emp.id}
							className={`emp-card ${emp.role === 'ADMIN' ? 'admin-card' : ''}`}
						>
							<div className='emp-name'>{emp.name}</div>
							<div className='emp-email'>@{emp.email.split('@')[0]}</div>

							{/* НОВОЕ: Отображение города, если он есть */}
							{emp.city && (
								<div
									style={{
										fontSize: '12px',
										color: '#666',
										marginTop: '4px',
										marginBottom: '8px',
										fontWeight: '500',
									}}
								>
									📍 {emp.city}
								</div>
							)}

							<div
								className={`role-badge ${roleClasses[emp.role] || 'role-tech'}`}
								style={{ marginTop: emp.city ? '0' : '8px' }}
							>
								{roleLabels[emp.role] || emp.role}
							</div>

							{/* РЕНДЕРИМ КНОПКИ ТОЛЬКО ДЛЯ АДМИНА */}
							{(isAdmin || isCurrentUser(emp)) && (
								<div className='emp-actions'>
									<button className='btn-edit' onClick={() => handleEdit(emp)}>
										Изменить
									</button>

									{isAdmin && (
										<button
											className='btn-delete'
											onClick={() => handleDelete(emp.id, emp.name)}
										>
											Удалить
										</button>
									)}
								</div>
							)}
						</div>
					))}
				</div>
			)}

			{isModalOpen && (
				<div className='employee-modal-overlay'>
					<div className='employee-modal'>
						<div className='employee-modal-header'>
							<h2>Редактирование сотрудника</h2>
							<button
								className='employee-modal-close'
								onClick={() => setIsModalOpen(false)}
							>
								×
							</button>
						</div>

						<div className='employee-modal-body'>
							{canEditIdentityFields ? (
								<>
									<label>
										Имя
										<input
											type='text'
											name='name'
											placeholder='Имя'
											value={formData.name}
											onChange={handleChange}
										/>
									</label>

									<label>
										Email
										<input
											type='email'
											name='email'
											placeholder='Email'
											value={formData.email}
											onChange={handleChange}
										/>
									</label>
								</>
							) : (
								<div className='employee-readonly-note'>
									Имя и email может изменить только администратор.
								</div>
							)}

							<label>
								Новый пароль
								<input
									type='password'
									name='password'
									placeholder='Оставьте пустым, если не нужно менять'
									value={formData.password}
									onChange={handleChange}
								/>
							</label>

							{isAdmin && (
								<>
									<label>
										Роль
										<select
											name='role'
											value={formData.role}
											onChange={handleChange}
										>
											{Object.entries(roleLabels).map(
												([roleValue, roleLabel]) => (
													<option key={roleValue} value={roleValue}>
														{roleLabel}
													</option>
												),
											)}
										</select>
									</label>

									{/* Выбор города в модалке редактирования */}
									<label>
										Город
										<select
											name='city'
											value={formData.city}
											onChange={handleChange}
										>
											<option value=''>Все города (без привязки)</option>

											{cities.map(city => (
												<option key={city.id} value={city.name}>
													{city.name}
												</option>
											))}
										</select>
									</label>
								</>
							)}
						</div>

						<div className='employee-modal-actions'>
							<button className='btn-save' onClick={handleSave}>
								Сохранить
							</button>
							<button
								className='btn-cancel'
								onClick={() => setIsModalOpen(false)}
							>
								Отмена
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
