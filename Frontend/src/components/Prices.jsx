import React, { useEffect, useMemo, useState } from 'react'
import '../styles/Prices.css'

const API_BASE_URL = 'http://127.0.0.1:8000'

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

const categoryLabels = {
	GPS_TRACKER: 'GPS-трекеры',
	BEACON: 'Маяки',
	SUBSCRIPTION: 'Абонентская плата',
	INSTALLATION_SERVICE: 'Установка',
	VISIT: 'Выезды',
	FUEL_SENSOR: 'ДУТ',
	GPS_CAN: 'CAN-шина',
	REMOVAL_SERVICE: 'Снятие',
	DIAGNOSTIC_SERVICE: 'Диагностика',
}

const formatMoney = value => {
	const number = Number(value || 0)

	if (Number.isNaN(number)) return `${value} тг`

	return `${number.toLocaleString('ru-RU')} тг`
}

export default function Prices() {
	const [prices, setPrices] = useState([])
	const [clients, setClients] = useState([])
	const [selectedClientId, setSelectedClientId] = useState('')
	const [clientPrices, setClientPrices] = useState([])

	const [loading, setLoading] = useState(false)
	const [clientPricesLoading, setClientPricesLoading] = useState(false)
	const [error, setError] = useState('')

	const [isCreateModalOpen, setCreateModalOpen] = useState(false)
	const [editingPrice, setEditingPrice] = useState(null)

	const [baseForm, setBaseForm] = useState({
		code: '',
		name: '',
		category: '',
		default_price: '',
		unit: 'шт',
		is_active: true,
	})

	const [editingClientPriceId, setEditingClientPriceId] = useState(null)
	const [clientPriceValue, setClientPriceValue] = useState('')

	const userRole = getUserRole()
	const canReadPrices = ['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(userRole)
	const canManagePrices = ['ADMIN', 'MANAGER'].includes(userRole)

	useEffect(() => {
		if (!canReadPrices) return

		fetchPrices()
		fetchClients()
	}, [canReadPrices])

	useEffect(() => {
		if (selectedClientId) {
			fetchClientPrices(selectedClientId)
		} else {
			setClientPrices([])
		}
	}, [selectedClientId])

	const authHeaders = useMemo(() => {
		const token = localStorage.getItem('access_token')

		return {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		}
	}, [])

	const fetchPrices = async () => {
		setLoading(true)
		setError('')

		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch(`${API_BASE_URL}/prices`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить цены')
			}

			const data = await res.json()
			setPrices(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const fetchClients = async () => {
		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch(`${API_BASE_URL}/clients`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (res.ok) {
				const data = await res.json()
				setClients(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки клиентов:', err)
		}
	}

	const fetchClientPrices = async clientId => {
		setClientPricesLoading(true)
		setError('')

		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch(`${API_BASE_URL}/prices/client/${clientId}`, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить цены клиента')
			}

			const data = await res.json()
			setClientPrices(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setClientPricesLoading(false)
		}
	}

	const resetBaseForm = () => {
		setBaseForm({
			code: '',
			name: '',
			category: '',
			default_price: '',
			unit: 'шт',
			is_active: true,
		})
		setEditingPrice(null)
	}

	const openCreateModal = () => {
		resetBaseForm()
		setCreateModalOpen(true)
	}

	const openEditModal = price => {
		setEditingPrice(price)
		setBaseForm({
			code: price.code || '',
			name: price.name || '',
			category: price.category || '',
			default_price: price.default_price ?? '',
			unit: price.unit || 'шт',
			is_active: Boolean(price.is_active),
		})
		setCreateModalOpen(true)
	}

	const closeBaseModal = () => {
		setCreateModalOpen(false)
		resetBaseForm()
	}

	const handleBaseFormChange = e => {
		const { name, value, type, checked } = e.target

		setBaseForm(prev => ({
			...prev,
			[name]: type === 'checkbox' ? checked : value,
		}))
	}

	const handleSaveBasePrice = async e => {
		e.preventDefault()
		setError('')

		if (!baseForm.code.trim()) {
			setError('Код цены обязателен')
			return
		}

		if (!baseForm.name.trim()) {
			setError('Название цены обязательно')
			return
		}

		if (!baseForm.category.trim()) {
			setError('Категория обязательна')
			return
		}

		const parsedPrice = Number(baseForm.default_price)

		if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
			setError('Цена должна быть числом не меньше 0')
			return
		}

		try {
			const payload = {
				code: baseForm.code.trim(),
				name: baseForm.name.trim(),
				category: baseForm.category.trim(),
				default_price: parsedPrice,
				unit: baseForm.unit.trim() || 'шт',
			}

			let res

			if (editingPrice) {
				res = await fetch(`${API_BASE_URL}/prices/${editingPrice.id}`, {
					method: 'PATCH',
					headers: authHeaders,
					body: JSON.stringify({
						...payload,
						is_active: baseForm.is_active,
					}),
				})
			} else {
				res = await fetch(`${API_BASE_URL}/prices`, {
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify(payload),
				})
			}

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось сохранить цену')
			}

			closeBaseModal()
			await fetchPrices()

			if (selectedClientId) {
				await fetchClientPrices(selectedClientId)
			}
		} catch (err) {
			setError(err.message)
		}
	}

	const handleToggleBasePrice = async price => {
		if (!canManagePrices) return

		const isActive = Boolean(price.is_active)
		const confirmText = isActive
			? `Отключить позицию "${price.name}"?`
			: `Включить позицию "${price.name}"?`

		if (!window.confirm(confirmText)) return

		try {
			const url = isActive
				? `${API_BASE_URL}/prices/${price.id}`
				: `${API_BASE_URL}/prices/${price.id}/restore`

			const res = await fetch(url, {
				method: isActive ? 'DELETE' : 'PATCH',
				headers: authHeaders,
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось изменить статус цены')
			}

			await fetchPrices()

			if (selectedClientId) {
				await fetchClientPrices(selectedClientId)
			}
		} catch (err) {
			setError(err.message)
		}
	}

	const startEditClientPrice = item => {
		setEditingClientPriceId(item.price_item_id)
		setClientPriceValue(item.effective_price ?? item.default_price ?? '')
	}

	const cancelEditClientPrice = () => {
		setEditingClientPriceId(null)
		setClientPriceValue('')
	}

	const saveClientPrice = async item => {
		if (!selectedClientId) return

		const price = Number(clientPriceValue)

		if (Number.isNaN(price) || price < 0) {
			setError('Индивидуальная цена должна быть числом не меньше 0')
			return
		}

		try {
			const res = await fetch(
				`${API_BASE_URL}/prices/client/${selectedClientId}`,
				{
					method: 'PUT',
					headers: authHeaders,
					body: JSON.stringify({
						prices: [
							{
								price_item_id: item.price_item_id,
								price,
							},
						],
					}),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось сохранить цену клиента')
			}

			cancelEditClientPrice()
			await fetchClientPrices(selectedClientId)
		} catch (err) {
			setError(err.message)
		}
	}

	const resetClientPrice = async item => {
		if (!selectedClientId) return

		if (!window.confirm(`Сбросить индивидуальную цену "${item.name}"?`)) return

		try {
			const res = await fetch(
				`${API_BASE_URL}/prices/client/${selectedClientId}/${item.price_item_id}`,
				{
					method: 'DELETE',
					headers: authHeaders,
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось сбросить цену клиента')
			}

			await fetchClientPrices(selectedClientId)
		} catch (err) {
			setError(err.message)
		}
	}

	const getClientDisplayName = client => {
		if (!client) return 'Клиент'

		if (client.type === 'TOO' || client.type === 'IP') {
			return client.company_name || client.name || `Клиент #${client.id}`
		}

		return client.name || client.company_name || `Клиент #${client.id}`
	}

	const groupedPrices = useMemo(() => {
		const groups = {}

		prices.forEach(item => {
			const category = item.category || 'OTHER'

			if (!groups[category]) {
				groups[category] = []
			}

			groups[category].push(item)
		})

		return groups
	}, [prices])

	if (!canReadPrices) {
		return (
			<div className='prices-page'>
				<div className='prices-header'>
					<h2>Цены</h2>
					<p>У вас нет доступа к этой вкладке.</p>
				</div>
			</div>
		)
	}

	return (
		<div className='prices-page'>
			<div className='prices-header'>
				<div>
					<h2>Цены</h2>
					<p>Справочник базовых и индивидуальных цен клиентов.</p>
				</div>

				{canManagePrices && (
					<button className='prices-primary-btn' onClick={openCreateModal}>
						+ Добавить цену
					</button>
				)}
			</div>

			{error && <div className='prices-error'>{error}</div>}

			<div className='prices-layout'>
				<section className='prices-card'>
					<div className='prices-card-header'>
						<div>
							<h3>Базовые цены</h3>
							<p>
								Используются по умолчанию, если для клиента нет индивидуальной
								цены.
							</p>
						</div>
					</div>

					{loading ? (
						<div className='prices-empty'>Загрузка цен...</div>
					) : prices.length === 0 ? (
						<div className='prices-empty'>Цены пока не добавлены</div>
					) : (
						<div className='prices-category-list'>
							{Object.entries(groupedPrices).map(([category, items]) => (
								<div key={category} className='prices-category-block'>
									<div className='prices-category-title'>
										{categoryLabels[category] || category}
									</div>

									<div className='prices-table-wrap'>
										<table className='prices-table'>
											<thead>
												<tr>
													<th>Наименование</th>
													<th>Код</th>
													<th>Цена</th>
													<th>Ед.</th>
													<th>Статус</th>
													<th style={{ textAlign: 'right' }}>Действия</th>
												</tr>
											</thead>

											<tbody>
												{items.map(price => (
													<tr
														key={price.id}
														className={
															!price.is_active ? 'prices-muted-row' : ''
														}
													>
														<td>
															<strong>{price.name}</strong>
														</td>
														<td>
															<span className='prices-code'>{price.code}</span>
														</td>
														<td>{formatMoney(price.default_price)}</td>
														<td>{price.unit || 'шт'}</td>
														<td>
															<span
																className={`prices-status ${price.is_active ? 'active' : 'inactive'}`}
															>
																{price.is_active ? 'Активна' : 'Отключена'}
															</span>
														</td>
														<td>
															<div className='prices-actions'>
																{canManagePrices ? (
																	<>
																		<button
																			className='prices-edit-btn'
																			onClick={() => openEditModal(price)}
																		>
																			Редактировать
																		</button>

																		<button
																			className={
																				price.is_active
																					? 'prices-disable-btn'
																					: 'prices-enable-btn'
																			}
																			onClick={() =>
																				handleToggleBasePrice(price)
																			}
																		>
																			{price.is_active
																				? 'Отключить'
																				: 'Включить'}
																		</button>
																	</>
																) : (
																	<span className='prices-readonly'>
																		Просмотр
																	</span>
																)}
															</div>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							))}
						</div>
					)}
				</section>

				<section className='prices-card'>
					<div className='prices-card-header'>
						<div>
							<h3>Цены для клиента</h3>
							<p>Индивидуальные цены имеют приоритет над базовыми.</p>
						</div>
					</div>

					<label className='prices-field'>
						<span>Клиент</span>
						<select
							className='prices-input'
							value={selectedClientId}
							onChange={e => {
								setSelectedClientId(e.target.value)
								cancelEditClientPrice()
							}}
						>
							<option value=''>— выберите клиента —</option>

							{clients.map(client => (
								<option key={client.id} value={client.id}>
									{getClientDisplayName(client)}
								</option>
							))}
						</select>
					</label>

					{!selectedClientId ? (
						<div className='prices-empty'>
							Выберите клиента, чтобы настроить индивидуальные цены.
						</div>
					) : clientPricesLoading ? (
						<div className='prices-empty'>Загрузка цен клиента...</div>
					) : (
						<div className='prices-table-wrap'>
							<table className='prices-table'>
								<thead>
									<tr>
										<th>Наименование</th>
										<th>Базовая</th>
										<th>Цена клиента</th>
										<th>Итоговая</th>
										<th style={{ textAlign: 'right' }}>Действия</th>
									</tr>
								</thead>

								<tbody>
									{clientPrices.map(item => (
										<tr
											key={item.price_item_id}
											className={!item.is_active ? 'prices-muted-row' : ''}
										>
											<td>
												<strong>{item.name}</strong>
												<div className='prices-small-muted'>
													{categoryLabels[item.category] || item.category} ·{' '}
													{item.unit}
												</div>
											</td>

											<td>{formatMoney(item.default_price)}</td>

											<td>
												{editingClientPriceId === item.price_item_id ? (
													<input
														className='prices-input prices-price-input'
														type='number'
														min='0'
														value={clientPriceValue}
														onChange={e => setClientPriceValue(e.target.value)}
													/>
												) : item.has_override ? (
													<span className='prices-client-price'>
														{formatMoney(item.client_price)}
													</span>
												) : (
													<span className='prices-no-override'>—</span>
												)}
											</td>

											<td>
												<strong>{formatMoney(item.effective_price)}</strong>
											</td>

											<td>
												<div className='prices-actions'>
													{canManagePrices ? (
														editingClientPriceId === item.price_item_id ? (
															<>
																<button
																	className='prices-save-btn'
																	onClick={() => saveClientPrice(item)}
																>
																	Сохранить
																</button>

																<button
																	className='prices-cancel-btn'
																	onClick={cancelEditClientPrice}
																>
																	Отмена
																</button>
															</>
														) : (
															<>
																<button
																	className='prices-edit-btn'
																	onClick={() => startEditClientPrice(item)}
																	disabled={!item.is_active}
																>
																	Изменить
																</button>

																{Boolean(item.has_override) && (
																	<button
																		className='prices-disable-btn'
																		onClick={() => resetClientPrice(item)}
																	>
																		Сбросить
																	</button>
																)}
															</>
														)
													) : (
														<span className='prices-readonly'>Просмотр</span>
													)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			{isCreateModalOpen && (
				<div className='prices-modal-overlay'>
					<form className='prices-modal' onSubmit={handleSaveBasePrice}>
						<div className='prices-modal-header'>
							<h3>{editingPrice ? 'Редактировать цену' : 'Добавить цену'}</h3>
							<button type='button' onClick={closeBaseModal}>
								×
							</button>
						</div>

						<div className='prices-modal-body'>
							<label className='prices-field'>
								<span>Код</span>
								<input
									className='prices-input'
									name='code'
									value={baseForm.code}
									onChange={handleBaseFormChange}
									placeholder='GPS_FMB920'
								/>
							</label>

							<label className='prices-field'>
								<span>Название</span>
								<input
									className='prices-input'
									name='name'
									value={baseForm.name}
									onChange={handleBaseFormChange}
									placeholder='Teltonika FMB920'
								/>
							</label>

							<label className='prices-field'>
								<span>Категория</span>
								<input
									className='prices-input'
									name='category'
									value={baseForm.category}
									onChange={handleBaseFormChange}
									placeholder='GPS_TRACKER'
								/>
							</label>

							<label className='prices-field'>
								<span>Цена</span>
								<input
									className='prices-input'
									type='number'
									min='0'
									name='default_price'
									value={baseForm.default_price}
									onChange={handleBaseFormChange}
								/>
							</label>

							<label className='prices-field'>
								<span>Единица</span>
								<input
									className='prices-input'
									name='unit'
									value={baseForm.unit}
									onChange={handleBaseFormChange}
									placeholder='шт / мес / км'
								/>
							</label>

							{editingPrice && (
								<label className='prices-checkbox-field'>
									<input
										type='checkbox'
										name='is_active'
										checked={baseForm.is_active}
										onChange={handleBaseFormChange}
									/>
									<span>Активна</span>
								</label>
							)}
						</div>

						<div className='prices-modal-footer'>
							<button
								type='button'
								className='prices-cancel-btn'
								onClick={closeBaseModal}
							>
								Отмена
							</button>

							<button type='submit' className='prices-primary-btn'>
								Сохранить
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	)
}
