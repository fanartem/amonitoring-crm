import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import '../styles/Clients.css'
import '../styles/Requests.css'
import CreateClientModal from './CreateClientModal'
import RequestDetailModal from './RequestDetailModal'

const getUserRole = () => {
	try {
		const token = localStorage.getItem('access_token')
		if (!token) return null
		const base64Url = token.split('.')[1]
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map(function (c) {
					return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
				})
				.join(''),
		)
		return JSON.parse(jsonPayload).role
	} catch (error) {
		return null
	}
}

export default function Clients() {
	const [clients, setClients] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	const [selectedClient, setSelectedClient] = useState(null)
	const [clientRequests, setClientRequests] = useState([])
	const [clientVehicles, setClientVehicles] = useState([])
	const [isVehiclesLoading, setIsVehiclesLoading] = useState(false)
	const [technicians, setTechnicians] = useState([])
	const [vehicleEquipmentMap, setVehicleEquipmentMap] = useState({})

	const [isCreateModalOpen, setCreateModalOpen] = useState(false)
	const [editClientData, setEditClientData] = useState(null)

	const [selectedRequestId, setSelectedRequestId] = useState(null)
	const [activeDropdown, setActiveDropdown] = useState(null)

	// Состояние для редактируемого автомобиля
	const [editingVehicle, setEditingVehicle] = useState(null)
	const [showVehicles, setShowVehicles] = useState(false)

	const userRole = getUserRole()
	const location = useLocation()

	const canViewRequestPrice =
		userRole !== 'TECHNICIAN' && userRole !== 'SENIOR_TECHNICIAN'

	// Состояние для навигации из строки поиска
	const [pendingOpenClientId, setPendingOpenClientId] = useState(null)
	const [pendingHighlightVehicleId, setPendingHighlightVehicleId] = useState(null)
	const [highlightedVehicleId, setHighlightedVehicleId] = useState(null)
	const vehicleRefs = useRef({})

	useEffect(() => {
		fetchClients()
		fetchTechnicians()
	}, [])

	useEffect(() => {
		const handleClickOutside = () => setActiveDropdown(null)
		document.addEventListener('click', handleClickOutside)
		return () => document.removeEventListener('click', handleClickOutside)
	}, [])

	// 1. Читаем state из навигации (переход из строки поиска в хедере)
	useEffect(() => {
		if (!location.state?.openClientId) return
		setPendingOpenClientId(location.state.openClientId)
		if (location.state.highlightVehicleId) {
			setPendingHighlightVehicleId(location.state.highlightVehicleId)
		}
		// Очищаем state чтобы повторный рендер не сбрасывал всё
		window.history.replaceState({}, document.title)
	}, []) // eslint-disable-line react-hooks/exhaustive-deps

	// 2. Когда клиенты загружены + есть pending → открываем нужного клиента
	useEffect(() => {
		if (!pendingOpenClientId || clients.length === 0) return
		const client = clients.find(c => c.id === pendingOpenClientId)
		if (client) {
			setPendingOpenClientId(null)
			handleClientClick(client)
		}
	}, [clients, pendingOpenClientId]) // eslint-disable-line react-hooks/exhaustive-deps

	// 3. Когда клиент открыт + нужна подсветка → автоматически подгружаем его машины
	useEffect(() => {
		if (!selectedClient || !pendingHighlightVehicleId) return
		fetchClientVehicles(selectedClient.id, true)
	}, [selectedClient?.id, pendingHighlightVehicleId]) // eslint-disable-line react-hooks/exhaustive-deps

	// 4. Когда машины загрузились + есть pending highlight → скролл и подсветка
	useEffect(() => {
		if (!pendingHighlightVehicleId || clientVehicles.length === 0) return
		const vehicleId = pendingHighlightVehicleId
		setPendingHighlightVehicleId(null)
		setShowVehicles(true)
		setHighlightedVehicleId(vehicleId)

		// Скроллим к нужной машине
		setTimeout(() => {
			const el = vehicleRefs.current[vehicleId]
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
		}, 150)

		// Снимаем подсветку через 2.5 сек
		setTimeout(() => setHighlightedVehicleId(null), 2500)
	}, [clientVehicles.length, pendingHighlightVehicleId])

	const fetchClients = async () => {
		setLoading(true)
		setError('')
		try {
			const token = localStorage.getItem('access_token')
			const response = await fetch('http://127.0.0.1:8000/clients', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (!response.ok) {
				throw new Error('Не удалось загрузить список клиентов')
			}

			const data = await response.json()
			setClients(data.filter(c => !c.is_deleted))
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const fetchTechnicians = async () => {
		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch('http://127.0.0.1:8000/users/technicians', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) setTechnicians(await res.json())
		} catch (err) {
			console.error(err)
		}
	}

	const getTechName = techId => {
		if (!techId) return null
		const tech = technicians.find(t => t.id === techId)
		return tech ? tech.name : `ID: ${techId}`
	}

	const clientTypeLabels = {
		TOO: 'ТОО',
		IP: 'ИП',
		INDIVIDUAL: 'Физ. лицо',
	}

	const getClientTypeLabel = type => {
		return clientTypeLabels[type] || type || '—'
	}

	const getClientDisplayName = client => {
		const clientType = client.client_type || client.type

		if (clientType === 'TOO' || clientType === 'IP') {
			return client.company_name || client.client_name || client.name || '—'
		}

		return client.client_name || client.name || client.company_name || '—'
	}

	const getClientSubtitle = client => {
		const clientType = client.client_type || client.type

		if (
			(clientType === 'TOO' || clientType === 'IP') &&
			(client.client_name || client.name)
		) {
			return `${getClientTypeLabel(clientType)} · представитель: ${client.client_name || client.name}`
		}

		return getClientTypeLabel(clientType)
	}

	const getEquipmentBadgeText = item => {
		const titleParts = []

		if (item.name) titleParts.push(item.name)
		if (item.model) titleParts.push(item.model)

		const title = titleParts.join(' ') || 'Оборудование'

		const quantity = Number(item.quantity || 1)
		const quantityText = quantity > 1 ? ` ${quantity} шт.` : ''

		if (item.identifier_value) {
			return `${title}: ${item.identifier_type || 'ID'} ${item.identifier_value}${quantityText}`
		}

		if (item.serial_number) {
			return `${title}: S/N ${item.serial_number}${quantityText}`
		}

		return `${title}${quantityText}`
	}

	const getVehicleEquipment = vehicleId => {
		return vehicleEquipmentMap[vehicleId] || []
	}

	const getVehicleTitle = (vehicle, index) => {
		const title =
			`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
			`Авто ${index + 1}`
		const plate = vehicle.plate_number || 'б/н'

		return `${title} (${plate})`
	}

	const getVehicleInstallText = vehicle => {
		return `${vehicle.has_blocking ? 'С блокировкой' : 'Без блокировки'} • ${
			vehicle.has_beacon ? 'Маяк' : 'Без маяка'
		}`
	}

	const handleClientClick = async client => {
		setSelectedClient(client)
		setClientVehicles([])
		setVehicleEquipmentMap({})
		setShowVehicles(false)

		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(
				`http://127.0.0.1:8000/clients/${client.id}/requests`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			)

			if (res.ok) {
				const data = await res.json()
				setClientRequests(data)
				fetchEquipmentForClientRequests(data)
			}
		} catch (err) {
			console.error('Ошибка загрузки заявок клиента:', err)
		}
	}

	const fetchClientVehicles = async (clientId, silent = false) => {
		setIsVehiclesLoading(true)
		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(
				`http://127.0.0.1:8000/vehicles?client_id=${clientId}`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			)
			if (res.ok) {
				const data = await res.json()
				setClientVehicles(data)
				if (data.length === 0 && !silent)
					alert('У этого клиента пока нет добавленных автомобилей.')
			}
		} catch (err) {
			console.error('Ошибка загрузки машин:', err)
		} finally {
			setIsVehiclesLoading(false)
		}
	}

	const fetchEquipmentForClientRequests = async requestsList => {
		try {
			const token = localStorage.getItem('access_token')
			const equipmentByVehicle = {}

			await Promise.all(
				requestsList.map(async req => {
					if (!req.id) return

					try {
						const res = await fetch(
							`http://127.0.0.1:8000/warehouse/requests/${req.id}/equipment`,
							{
								headers: { Authorization: `Bearer ${token}` },
							},
						)

						if (!res.ok) return

						const equipment = await res.json()

						if (!Array.isArray(equipment) || equipment.length === 0) return

						equipment.forEach(item => {
							if (!item.vehicle_id) return

							if (!equipmentByVehicle[item.vehicle_id]) {
								equipmentByVehicle[item.vehicle_id] = []
							}

							const alreadyExists = equipmentByVehicle[item.vehicle_id].some(
								existing => existing.link_id === item.link_id,
							)

							if (!alreadyExists) {
								equipmentByVehicle[item.vehicle_id].push({
									...item,
									request_id: req.id,
								})
							}
						})
					} catch (err) {
						console.error(`Ошибка загрузки оборудования заявки ${req.id}:`, err)
					}
				}),
			)

			setVehicleEquipmentMap(equipmentByVehicle)
		} catch (err) {
			console.error('Ошибка загрузки оборудования по машинам:', err)
		}
	}

	const handleDeleteClient = async (e, clientId, clientName) => {
		e.stopPropagation()
		setActiveDropdown(null)
		if (
			!window.confirm(`Вы уверены, что хотите удалить клиента "${clientName}"?`)
		)
			return

		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(`http://127.0.0.1:8000/clients/${clientId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})

			if (res.ok) {
				alert('Клиент успешно удален в корзину!')
				fetchClients()
				if (selectedClient && selectedClient.id === clientId) {
					setSelectedClient(null)
				}
			} else {
				const errData = await res.text()
				throw new Error(errData)
			}
		} catch (err) {
			alert(`Ошибка при удалении: ${err.message}`)
		}
	}

	const handleEditClientClick = (e, client) => {
		e.stopPropagation()
		setActiveDropdown(null)
		setEditClientData(client)
		setCreateModalOpen(true)
	}

	const toggleDropdown = (e, clientId) => {
		e.stopPropagation()
		setActiveDropdown(prev => (prev === clientId ? null : clientId))
	}

	// ФУНКЦИЯ ДЛЯ СОХРАНЕНИЯ ОТРЕДАКТИРОВАННОГО АВТО (без IMEI, так как он берется со склада)
	const handleVehicleSubmit = async e => {
		e.preventDefault()
		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(
				`http://127.0.0.1:8000/vehicles/${editingVehicle.id}`,
				{
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						brand: editingVehicle.brand,
						model: editingVehicle.model,
						plate_number: editingVehicle.plate_number,
						vin: editingVehicle.vin,
						year: editingVehicle.year
							? parseInt(editingVehicle.year, 10)
							: null,
					}),
				},
			)
			if (!res.ok) throw new Error(await res.text())
			alert('Данные авто успешно обновлены!')
			setEditingVehicle(null)
			fetchClientVehicles(selectedClient.id)
			handleClientClick(selectedClient)
		} catch (err) {
			alert('Ошибка: ' + err.message)
		}
	}

	const statusLabels = {
		NEW: 'В ожидании',
		IN_PROGRESS: 'В процессе установки',
		COMPLETED: 'Работы завершены',
		CANCELLED: 'Отменено',
	}

	const statusClasses = {
		NEW: 'status-new',
		IN_PROGRESS: 'status-progress',
		COMPLETED: 'status-done',
		CANCELLED: 'status-cancelled',
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

	const formatMoney = value => {
		const number = Number(value || 0)

		if (Number.isNaN(number)) return `${value} тг`

		return `${number.toLocaleString('ru-RU')} тг`
	}

	return (
		<div className='clients-page-container'>
			<style>{`
				@keyframes vehiclePulse {
					0%   { background: #fffde7; border-color: #f9a825; box-shadow: 0 0 0 4px rgba(249,168,37,0.25); }
					40%  { background: #fffde7; border-color: #f9a825; box-shadow: 0 0 0 4px rgba(249,168,37,0.25); }
					100% { background: transparent; border-color: #e0e0e0; box-shadow: none; }
				}
				.vehicle-highlighted {
					animation: vehiclePulse 2.5s ease-out forwards;
				}
			`}</style>
			{!selectedClient ? (
				<>
					<div className='clients-header-bar'>
						<h2>Клиенты</h2>
						<div className='clients-header-actions'>
							<span className='subtitle-text'>
								Клиенты из заявок и созданные вручную
							</span>
							{(userRole === 'ADMIN' || userRole === 'MANAGER') && (
								<button
									className='btn-green'
									onClick={() => {
										setEditClientData(null)
										setCreateModalOpen(true)
									}}
								>
									+ Добавить клиента
								</button>
							)}
						</div>
					</div>

					{loading ? (
						<div
							style={{ padding: '40px', textAlign: 'center', color: '#888' }}
						>
							Загрузка клиентов...
						</div>
					) : error ? (
						<div
							style={{ padding: '40px', textAlign: 'center', color: '#c53030' }}
						>
							{error}
						</div>
					) : clients.length === 0 ? (
						<div
							style={{ padding: '40px', textAlign: 'center', color: '#888' }}
						>
							Нет клиентов
						</div>
					) : (
						<div className='clients-grid'>
							{clients.map(client => (
								<div
									key={client.id}
									className='client-card'
									style={{
										cursor: 'default',
										position: 'relative',
										zIndex: activeDropdown === client.id ? 100 : 1,
									}}
								>
									<div
										className='client-card-title'
										style={{
											display: 'flex',
											justifyContent: 'space-between',
											alignItems: 'flex-start',
										}}
									>
										<span style={{ paddingRight: '10px' }}>
											{client.company_name || client.name}
										</span>

										{(userRole === 'ADMIN' || userRole === 'MANAGER') && (
											<div
												className='card-actions-wrapper'
												style={{
													position: 'relative',
													marginTop: '-2px',
													marginRight: '-5px',
												}}
											>
												<div
													className='card-actions'
													style={{
														cursor: 'pointer',
														padding: '0 5px',
														fontSize: '20px',
														color: '#888',
														lineHeight: '1',
													}}
													onClick={e => toggleDropdown(e, client.id)}
												>
													&#8942;
												</div>

												{activeDropdown === client.id && (
													<div
														className='dropdown-menu'
														style={{
															position: 'absolute',
															right: 0,
															top: '25px',
															background: '#fff',
															border: '1px solid #eee',
															borderRadius: '6px',
															boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
															padding: '5px 0',
															minWidth: '150px',
															zIndex: 100,
														}}
													>
														<div
															className='dropdown-item'
															style={{
																padding: '8px 15px',
																cursor: 'pointer',
																fontSize: '14px',
																borderBottom: '1px solid #f5f5f5',
																color: '#333',
															}}
															onClick={e => handleEditClientClick(e, client)}
														>
															Редактировать
														</div>
														{userRole === 'ADMIN' && (
															<div
																className='dropdown-item'
																style={{
																	padding: '8px 15px',
																	cursor: 'pointer',
																	fontSize: '14px',
																	color: '#c62828',
																}}
																onClick={e =>
																	handleDeleteClient(
																		e,
																		client.id,
																		client.company_name || client.name,
																	)
																}
															>
																Удалить
															</div>
														)}
													</div>
												)}
											</div>
										)}
									</div>

									<div className='client-card-type'>
										{getClientTypeLabel(client.type)}
										{client.company_name ? ` · ${client.name}` : ''}
									</div>
									<div className='client-card-info'>
										{client.phone} {client.email ? ` · ${client.email}` : ''}
									</div>

									<div
										className='client-card-footer'
										style={{
											display: 'flex',
											justifyContent: 'space-between',
											alignItems: 'center',
											marginTop: '15px',
										}}
									>
										<div>
											<span className='request-count-label'>Заявок:</span>
											<span
												className={`request-count-badge ${client.request_count > 0 ? 'active' : ''}`}
												style={{ marginLeft: '8px' }}
											>
												{client.request_count || 0}
											</span>
										</div>
										<button
											className='btn-details'
											onClick={e => {
												e.stopPropagation()
												handleClientClick(client)
											}}
										>
											Детали
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</>
			) : (
				<div className='client-detail-view'>
					<div className='clients-header-bar'>
						<div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
							<button
								className='btn-back'
								onClick={() => setSelectedClient(null)}
							>
								&larr; Назад
							</button>
							<h2>{selectedClient.company_name || selectedClient.name}</h2>
						</div>
					</div>

					<div className='client-info-box' style={{ position: 'relative' }}>
						{(userRole === 'ADMIN' || userRole === 'MANAGER') && (
							<div
								style={{
									position: 'absolute',
									top: '20px',
									right: '20px',
									display: 'flex',
									gap: '10px',
								}}
							>
								<button
									className='btn-edit-request'
									onClick={e => handleEditClientClick(e, selectedClient)}
								>
									✎ Редактировать
								</button>
							</div>
						)}

						<div className='info-row'>
							<span className='info-key'>ФИО / Название</span>
							<span className='info-val'>
								{selectedClient.company_name || selectedClient.name}
							</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>Тип лица</span>
							<span className='info-val'>
								{getClientTypeLabel(selectedClient.type)}
							</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>Телефон</span>
							<span className='info-val'>{selectedClient.phone}</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>Email</span>
							<span className='info-val'>{selectedClient.email || '—'}</span>
						</div>

						<div
							style={{
								marginTop: '20px',
								paddingTop: '15px',
								borderTop: '1px solid #eee',
							}}
						>
							<button
								className='btn-green'
								onClick={() => {
									if (showVehicles) {
										setShowVehicles(false)
									} else {
										if (clientVehicles.length > 0) {
											setShowVehicles(true)
										} else {
											fetchClientVehicles(selectedClient.id)
											setShowVehicles(true)
										}
									}
								}}
								disabled={isVehiclesLoading}
								style={{ padding: '6px 12px', fontSize: '13px' }}
							>
								{isVehiclesLoading
									? 'Загрузка...'
									: showVehicles
										? '🚗 Скрыть машины клиента'
										: '🚗 Просмотреть все машины клиента'}
							</button>

							{/* БЛОК ВЫВОДА МАШИН С КНОПКОЙ ИЗМЕНИТЬ */}
							{showVehicles && clientVehicles.length > 0 && (
								<div
									style={{
										marginTop: '15px',
										background: '#f8f9fa',
										border: '1px solid #e0e0e0',
										borderRadius: '8px',
										padding: '15px',
									}}
								>
									<h4
										style={{
											margin: '0 0 10px 0',
											fontSize: '14px',
											color: '#333',
										}}
									>
										Транспорт клиента ({clientVehicles.length}):
									</h4>
									<div style={{ display: 'grid', gap: '10px' }}>
										{clientVehicles.map(v => (
											<div
												key={v.id}
												ref={el => { vehicleRefs.current[v.id] = el }}
												className={`vehicle-card${highlightedVehicleId === v.id ? ' vehicle-highlighted' : ''}`}
											>
												<div className='vehicle-card-main'>
													<div className='vehicle-card-header'>
														<strong className='vehicle-card-title'>
															{v.brand} {v.model}
														</strong>

														<div className='vehicle-equipment-badges'>
															{getVehicleEquipment(v.id).length > 0 ? (
																getVehicleEquipment(v.id).map(item => (
																	<span
																		key={item.link_id}
																		className='vehicle-equipment-badge'
																	>
																		{getEquipmentBadgeText(item)}
																	</span>
																))
															) : (
																<span className='vehicle-equipment-badge empty'>
																	Устройства не привязаны
																</span>
															)}
														</div>
													</div>

													<div className='vehicle-card-meta'>
														Гос. номер: {v.plate_number || 'б/н'} • VIN:{' '}
														{v.vin || '—'} • Год: {v.year || '—'}
													</div>
												</div>

												{(userRole === 'ADMIN' || userRole === 'MANAGER') && (
													<button
														className='btn-details vehicle-edit-btn'
														onClick={() => setEditingVehicle(v)}
													>
														✎ Изменить
													</button>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</div>

					<h3 className='section-title' style={{ marginTop: '30px' }}>
						Заявки клиента ({clientRequests.length})
					</h3>

					<div className='requests-list' style={{ marginTop: '15px' }}>
						{clientRequests.length === 0 ? (
							<div
								style={{
									textAlign: 'center',
									color: '#888',
									marginTop: '20px',
								}}
							>
								Нет заявок
							</div>
						) : null}

						{clientRequests.map(req => (
							<div
								key={req.id}
								className='request-card'
								style={{ position: 'relative', cursor: 'default' }}
							>
								<div className='card-column'>
									<div className='card-item'>
										<span className='card-label'>Статус</span>
										<div
											className={`status-badge ${statusClasses[req.status] || 'status-new'}`}
										>
											{statusLabels[req.status] || req.status}
										</div>
									</div>

									{/* --- НОВОЕ: Вид работы прямо под статусом --- */}
									<div className='card-item' style={{ marginTop: '8px' }}>
										<span className='card-label'>Вид работы</span>
										<span
											style={{
												fontSize: '15px',
												fontWeight: '600',
												color:
													req.work_type === 'INSTALLATION'
														? '#1565c0'
														: req.work_type === 'REMOVAL'
															? '#c62828'
															: '#e65100',
											}}
										>
											{req.work_type === 'INSTALLATION'
												? 'Установка'
												: req.work_type === 'REMOVAL'
													? 'Снятие'
													: 'Диагностика'}
										</span>
									</div>

									{req.assigned_to && (
										<div className='card-item' style={{ marginTop: '5px' }}>
											<span className='card-label'>Исполнитель</span>
											<span
												className='card-value'
												style={{
													fontWeight: '600',
													color: '#5e9424',
													fontSize: '13px',
												}}
											>
												{getTechName(req.assigned_to)}
											</span>
										</div>
									)}
								</div>

								<div className='card-column'>
									<div className='card-item'>
										<span className='card-label'>Авто</span>

										<div className='client-request-lines'>
											{req.vehicles && req.vehicles.length > 0 ? (
												req.vehicles.map((vehicle, index) => (
													<div
														key={vehicle.request_vehicle_id || index}
														className='client-request-line'
													>
														{getVehicleTitle(vehicle, index)}
													</div>
												))
											) : (
												<span className='card-value'>Авто не указаны</span>
											)}
										</div>
									</div>
									<div className='card-item'>
										<span className='card-label'>Город</span>
										<span className='card-value'>
											{req.city || 'Не указан'}
										</span>
									</div>
								</div>

								<div className='card-column'>
									<div className='card-item'>
										<span className='card-label'>Параметры</span>

										<div className='client-request-lines'>
											{req.work_type === 'INSTALLATION' &&
											req.vehicles &&
											req.vehicles.length > 0 ? (
												req.vehicles.map((vehicle, index) => {
													const title =
														`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
														`Авто ${index + 1}`

													return (
														<div
															key={vehicle.request_vehicle_id || index}
															className='client-request-line'
														>
															{title}: {getVehicleInstallText(vehicle)}
														</div>
													)
												})
											) : (
												<span style={{ color: '#aaa' }}>—</span>
											)}
										</div>
									</div>
									<div className='card-item'>
										<span className='card-label'>Формат</span>
										<span className='card-value'>
											{req.visit_type === 'ON_SITE' ? (
												<>
													Выезд к клиенту
													{/* --- НОВОЕ: Вывод адреса при выезде --- */}
													{req.address && (
														<div
															style={{
																fontSize: '12px',
																color: '#666',
																marginTop: '3px',
																fontWeight: 'normal',
																lineHeight: '1.2',
															}}
														>
															📍 {req.address}
														</div>
													)}
												</>
											) : (
												'В офисе'
											)}
										</span>
									</div>
								</div>

								<div className='card-column'>
									<div className='card-item'>
										<span className='card-label'>Дата</span>
										<span className='card-value'>
											{formatDate(req.created_at)}
										</span>
									</div>

									{canViewRequestPrice && (
										<div className='card-item request-card-price-box'>
											<span className='card-label'>Стоимость</span>
											<span className='request-card-price-value'>
												{formatMoney(req.total_price)}
											</span>
										</div>
									)}
									
									<div className='card-item'>
										<span className='card-label'>Оплата</span>
										<div
											style={{
												display: 'flex',
												flexDirection: 'row',
												gap: '8px',
												alignItems: 'center',
												marginTop: '2px',
											}}
										>
											<div
												className={`status-badge ${Boolean(req.is_paid) ? 'status-progress' : 'status-new'}`}
												style={{ padding: '2px 10px', fontSize: '11px' }}
											>
												{Boolean(req.is_paid) ? 'Оплачено' : 'Ожидает оплаты'}
											</div>
											{Boolean(req.is_paid) && req.paid_at && (
												<span
													style={{
														fontSize: '11px',
														color: '#888',
														fontWeight: '500',
													}}
												>
													{formatDate(req.paid_at).split(' ')[0]}
												</span>
											)}
										</div>
									</div>
								</div>

								<div
									className='card-actions-wrapper'
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '10px',
										position: 'absolute',
										top: '15px',
										right: '15px',
									}}
								>
									<button
										className='btn-details'
										onClick={e => {
											e.stopPropagation()
											setSelectedRequestId(req.id)
										}}
									>
										Детали
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* МОДАЛКА РЕДАКТИРОВАНИЯ АВТОМОБИЛЯ (БЕЗ РУЧНОГО ВВОДА IMEI) */}
			{editingVehicle && (
				<div
					className='modal-overlay open'
					onClick={() => setEditingVehicle(null)}
				>
					<div
						className='modal-window vehicle-modal-window'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Редактирование авто</span>
							<button
								className='modal-close'
								onClick={() => setEditingVehicle(null)}
								type='button'
							>
								&times;
							</button>
						</div>

						<div className='vehicle-modal-body'>
							<form onSubmit={handleVehicleSubmit} id='vehicle-form'>
								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>
										Основная информация
									</div>

									<div className='vehicle-form-grid'>
										<label className='vehicle-field'>
											<span className='vehicle-label required'>Марка</span>
											<input
												className='vehicle-input'
												value={editingVehicle.brand || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														brand: e.target.value,
													})
												}
												required
											/>
										</label>

										<label className='vehicle-field'>
											<span className='vehicle-label required'>Модель</span>
											<input
												className='vehicle-input'
												value={editingVehicle.model || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														model: e.target.value,
													})
												}
												required
											/>
										</label>

										<label className='vehicle-field'>
											<span className='vehicle-label'>Гос. номер</span>
											<input
												className='vehicle-input'
												value={editingVehicle.plate_number || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														plate_number: e.target.value,
													})
												}
											/>
										</label>

										<label className='vehicle-field'>
											<span className='vehicle-label'>Год выпуска</span>
											<input
												className='vehicle-input'
												type='number'
												value={editingVehicle.year || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														year: e.target.value,
													})
												}
											/>
										</label>

										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label'>VIN-код</span>
											<input
												className='vehicle-input'
												maxLength='17'
												value={editingVehicle.vin || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														vin: e.target.value,
													})
												}
											/>
										</label>
									</div>
								</div>

								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>
										Привязанное оборудование
									</div>

									<div className='vehicle-equipment-badges modal-equipment-badges'>
										{getVehicleEquipment(editingVehicle.id).length > 0 ? (
											getVehicleEquipment(editingVehicle.id).map(item => (
												<span
													key={item.link_id}
													className='vehicle-equipment-badge'
												>
													{getEquipmentBadgeText(item)}
												</span>
											))
										) : (
											<span className='vehicle-equipment-badge empty'>
												Устройства не привязаны
											</span>
										)}
									</div>

									<div className='vehicle-equipment-hint'>
										Устройства привязываются к автомобилю через заявку и склад.
										Здесь они отображаются только для просмотра.
									</div>
								</div>
							</form>
						</div>

						<div className='modal-footer vehicle-modal-footer'>
							<button
								className='vehicle-cancel-btn'
								type='button'
								onClick={() => setEditingVehicle(null)}
							>
								Отмена
							</button>

							<button
								className='vehicle-submit-btn'
								type='submit'
								form='vehicle-form'
							>
								Сохранить
							</button>
						</div>
					</div>
				</div>
			)}

			<CreateClientModal
				isOpen={isCreateModalOpen}
				editClient={editClientData}
				onClose={() => {
					setCreateModalOpen(false)
					setEditClientData(null)
				}}
				onCreated={() => {
					setCreateModalOpen(false)
					setEditClientData(null)
					fetchClients()
					if (selectedClient) {
						handleClientClick(selectedClient)
					}
				}}
			/>

			<RequestDetailModal
				isOpen={!!selectedRequestId}
				requestId={selectedRequestId}
				onClose={() => setSelectedRequestId(null)}
				onUpdated={() => {
					if (selectedClient) handleClientClick(selectedClient)
				}}
			/>
		</div>
	)
}
