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
		city: '',
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

	const isCurrentUser = emp => Number(emp.id) === currentUserId

	// Открытые папки — по умолчанию только папка текущего юзера
	const [openFolders, setOpenFolders] = useState(
		currentUserRole ? { [currentUserRole]: true } : {},
	)

	const toggleFolder = role => {
		setOpenFolders(prev => ({ ...prev, [role]: !prev[role] }))
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
			city: emp.city || '',
		})
		setIsModalOpen(true)
	}

	const handleChange = e => {
		const { name, value } = e.target
		setFormData(prev => ({ ...prev, [name]: value }))
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
			if (formData.password) body.password = formData.password
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

	// Словари
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

	const roleFolderLabels = {
		ADMIN: 'Администраторы',
		ROP: 'РОП',
		MANAGER: 'Менеджеры',
		TECH_SUPPORT: 'Тех. поддержка',
		SENIOR_TECHNICIAN: 'Старшие монтажники',
		TECHNICIAN: 'Монтажники',
		ACCOUNTANT: 'Бухгалтеры',
		WAREHOUSE_MANAGER: 'Склад',
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

	const roleFolderColors = {
		ADMIN: '#f0f4c3',
		ROP: '#ede7f6',
		MANAGER: '#e3f2fd',
		TECH_SUPPORT: '#d4f2fa',
		SENIOR_TECHNICIAN: '#fff3e0',
		TECHNICIAN: '#f5f5f5',
		ACCOUNTANT: '#dbeee9',
		WAREHOUSE_MANAGER: '#f3e5f5',
	}

	const roleOrder = [
		'ADMIN',
		'ROP',
		'MANAGER',
		'ACCOUNTANT',
		'WAREHOUSE_MANAGER',
		'SENIOR_TECHNICIAN',
		'TECHNICIAN',
		'TECH_SUPPORT',
	]

	// Группируем по ролям, текущий юзер — первый в своей группе
	const filtered = employees.filter(emp => emp.email !== 'admin@amonitoring.kz')

	const grouped = roleOrder.reduce((acc, role) => {
		const group = filtered
			.filter(emp => emp.role === role)
			.sort((a, b) => {
				if (isCurrentUser(a)) return -1
				if (isCurrentUser(b)) return 1
				return a.name.localeCompare(b.name, 'ru')
			})
		if (group.length > 0) acc[role] = group
		return acc
	}, {})

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
				<div className='emp-folders'>
					{Object.entries(grouped).map(([role, members]) => {
						const isOpen = !!openFolders[role]
						const folderColor = roleFolderColors[role] || '#f5f5f5'
						const hasCurrentUser = members.some(isCurrentUser)

						return (
							<div key={role} className={`emp-folder ${isOpen ? 'open' : ''}`}>
								<button
									className='emp-folder-header'
									onClick={() => toggleFolder(role)}
									style={{ '--folder-color': folderColor }}
								>
									<span className='emp-folder-icon'>{isOpen ? '📂' : '📁'}</span>
									<span className='emp-folder-title'>
										{roleFolderLabels[role] || role}
									</span>
									<span className='emp-folder-count'>{members.length}</span>
									{hasCurrentUser && (
										<span className='emp-folder-you-badge'>Вы здесь</span>
									)}
									<span className='emp-folder-chevron'>{isOpen ? '▲' : '▼'}</span>
								</button>

								{isOpen && (
									<div className='emp-folder-grid'>
										{members.map(emp => (
											<div
												key={emp.id}
												className={`emp-card ${isCurrentUser(emp) ? 'current-user-card' : ''}`}
											>
												{isCurrentUser(emp) && (
													<div className='emp-you-tag'>Вы</div>
												)}
												<div className='emp-name'>{emp.name}</div>
												<div className='emp-email'>@{emp.email.split('@')[0]}</div>

												{emp.city && (
													<div className='emp-city'>📍 {emp.city}</div>
												)}

												<div
													className={`role-badge ${roleClasses[emp.role] || 'role-tech'}`}
													style={{ marginTop: emp.city ? '0' : '8px' }}
												>
													{roleLabels[emp.role] || emp.role}
												</div>

												{(isAdmin || isCurrentUser(emp)) && (
													<div className='emp-actions'>
														<button
															className='btn-edit'
															onClick={() => handleEdit(emp)}
														>
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
							</div>
						)
					})}
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
											{Object.entries(roleLabels).map(([roleValue, roleLabel]) => (
												<option key={roleValue} value={roleValue}>
													{roleLabel}
												</option>
											))}
										</select>
									</label>

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