import React, { useState, useEffect, useMemo } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Clients.css'

// Тот же список, что в CreateRequestModal. Справочник платформ в базе —
// отдельная задача; пока храним строку.
const PLATFORM_OPTIONS = ['Wialon', 'GLONASS Soft', 'Amonitoring']

// Командировки в параметрах нет намеренно: километраж зависит от адреса,
// а не от шаблона. Backend такой код тоже не примет.
const VISIT_PRICE_CODE_OPTIONS = [
	{ code: 'ON_SITE_CITY', label: 'В черте города' },
	{ code: 'ON_SITE_OUTSIDE_CITY', label: 'За пределы города' },
]

const createLocalId = () =>
	crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

const createEmptySensor = () => ({
	local_id: createLocalId(),
	name: '',
	price: '',
})

const EMPTY_FORM = {
	visit_type: '',
	visit_price_code: 'ON_SITE_CITY',
	platform: '',
	gps_price_code: '',
	tracker_subscription_months: 1,
	has_blocking: false,
	has_beacon: false,
	beacon_subscription_months: 1,

	// По умолчанию VIN обязателен: снимают требование точечно
	// и осознанно, а не по недосмотру при заведении шаблона.
	vin_required: true,

	// По умолчанию клиент выбирает время работ сам. Снимают галочку
	// тем, у кого время по договору определяем мы, — банкам.
	schedule_time_required: true,
}

const formatDateTime = value => {
	if (!value) return '—'

	const date = new Date(value)

	if (Number.isNaN(date.getTime())) return '—'

	return (
		date.toLocaleDateString('ru-RU') +
		' ' +
		date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
	)
}

export default function ClientInstallationSettingsModal({
	isOpen,
	client,
	onClose,
	onSaved,
}) {
	const clientId = client?.id || null

	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')
	const [notice, setNotice] = useState('')

	const [source, setSource] = useState('NONE')
	const [inheritedFromName, setInheritedFromName] = useState(null)
	const [canManage, setCanManage] = useState(false)
	const [updatedAt, setUpdatedAt] = useState(null)

	const [priceItems, setPriceItems] = useState([])
	const [form, setForm] = useState(EMPTY_FORM)
	const [sensors, setSensors] = useState([])

	const gpsTrackerItems = useMemo(
		() =>
			(priceItems || []).filter(
				item => item.category === 'GPS_TRACKER' && item.is_active,
			),
		[priceItems],
	)

	useEffect(() => {
		if (!isOpen || !clientId) return

		let cancelled = false

		const load = async () => {
			setLoading(true)
			setError('')
			setNotice('')

			try {
				const [pricesRes, settingsRes] = await Promise.all([
					fetch(`${API_BASE_URL}/prices?active_only=true`, {
						headers: getAuthHeaders(),
					}),
					fetch(`${API_BASE_URL}/clients/${clientId}/installation-settings`, {
						headers: getAuthHeaders(),
					}),
				])

				if (!settingsRes.ok) {
					const data = await settingsRes.json().catch(() => null)
					throw new Error(
						data?.detail || 'Не удалось загрузить параметры установки',
					)
				}

				const settingsData = await settingsRes.json()
				const priceData = pricesRes.ok ? await pricesRes.json() : []

				if (cancelled) return

				const priceList = Array.isArray(priceData) ? priceData : []

				const trackers = priceList.filter(
					item => item.category === 'GPS_TRACKER' && item.is_active,
				)

				setPriceItems(priceList)
				setSource(settingsData.source || 'NONE')
				setInheritedFromName(settingsData.inherited_from_client_name || null)
				setCanManage(Boolean(settingsData.can_manage))

				const loaded = settingsData.settings

				if (loaded) {
					setUpdatedAt(loaded.updated_at || null)

					setForm({
						visit_type: loaded.visit_type || '',
						visit_price_code: loaded.visit_price_code || 'ON_SITE_CITY',
						platform: loaded.platform || '',
						gps_price_code: loaded.gps_price_code || '',
						tracker_subscription_months: Number(
							loaded.tracker_subscription_months || 0,
						),
						has_blocking: Boolean(loaded.has_blocking),
						has_beacon: Boolean(loaded.has_beacon),
						beacon_subscription_months: Number(
							loaded.beacon_subscription_months || 0,
						),

						// Отсутствие поля читаем как «обязателен» — то же
						// правило, что на бэкенде: молчание значит «как
						// у всех», а не «можно без VIN».
						vin_required: loaded.vin_required !== false,
						schedule_time_required: loaded.schedule_time_required !== false,
					})
				} else {
					setUpdatedAt(null)

					setForm({
						...EMPTY_FORM,
						gps_price_code: trackers[0]?.code || '',
					})
				}

				setSensors(
					(settingsData.sensors || []).map(sensor => ({
						local_id: createLocalId(),
						name: sensor.name || '',
						price:
							sensor.price === null || sensor.price === undefined
								? ''
								: String(sensor.price),
					})),
				)
			} catch (err) {
				if (!cancelled) setError(err.message)
			} finally {
				if (!cancelled) setLoading(false)
			}
		}

		load()

		return () => {
			cancelled = true
		}
	}, [isOpen, clientId])

	if (!isOpen) return null

	const isReadOnly = !canManage || loading || saving

	const updateForm = (field, value) => {
		setNotice('')

		setForm(prev => {
			if (field === 'gps_price_code' && !value) {
				return {
					...prev,
					gps_price_code: '',
					tracker_subscription_months: 0,
					has_blocking: false,
				}
			}

			if (field === 'gps_price_code' && value) {
				return {
					...prev,
					gps_price_code: value,
					tracker_subscription_months:
						Number(prev.tracker_subscription_months) > 0
							? prev.tracker_subscription_months
							: 1,
				}
			}

			if (field === 'has_beacon' && !value) {
				return { ...prev, has_beacon: false, beacon_subscription_months: 0 }
			}

			if (field === 'has_beacon' && value) {
				return {
					...prev,
					has_beacon: true,
					beacon_subscription_months:
						Number(prev.beacon_subscription_months) > 0
							? prev.beacon_subscription_months
							: 1,
				}
			}

			return { ...prev, [field]: value }
		})
	}

	const updateSensor = (localId, field, value) => {
		setNotice('')

		setSensors(prev =>
			prev.map(sensor =>
				sensor.local_id === localId ? { ...sensor, [field]: value } : sensor,
			),
		)
	}

	const addSensor = () => {
		setNotice('')
		setSensors(prev => [...prev, createEmptySensor()])
	}

	const removeSensor = localId => {
		setNotice('')
		setSensors(prev => prev.filter(sensor => sensor.local_id !== localId))
	}

	const validate = () => {
		if (form.gps_price_code && Number(form.tracker_subscription_months) < 0) {
			return 'Подписка трекера не может быть отрицательной'
		}

		if (form.has_beacon && Number(form.beacon_subscription_months) < 0) {
			return 'Подписка маяка не может быть отрицательной'
		}

		for (const sensor of sensors) {
			if (!sensor.name.trim()) continue

			const price = sensor.price === '' ? 0 : Number(sensor.price)

			if (Number.isNaN(price) || price < 0) {
				return `Некорректная цена датчика «${sensor.name.trim()}»`
			}
		}

		return null
	}

	const handleSave = async () => {
		const validationError = validate()

		if (validationError) {
			setError(validationError)
			return
		}

		setSaving(true)
		setError('')
		setNotice('')

		try {
			const payload = {
				visit_type: form.visit_type || null,
				visit_price_code:
					form.visit_type === 'ON_SITE' ? form.visit_price_code || null : null,
				platform: form.platform || null,
				gps_price_code: form.gps_price_code || null,
				tracker_subscription_months: form.gps_price_code
					? Number(form.tracker_subscription_months || 0)
					: 0,
				has_blocking: form.gps_price_code ? Boolean(form.has_blocking) : false,
				has_beacon: Boolean(form.has_beacon),
				beacon_subscription_months: form.has_beacon
					? Number(form.beacon_subscription_months || 0)
					: 0,
				vin_required: Boolean(form.vin_required),
				schedule_time_required: Boolean(form.schedule_time_required),
				sensors: sensors
					.filter(sensor => sensor.name.trim())
					.map(sensor => ({
						name: sensor.name.trim(),
						price: sensor.price === '' ? 0 : Number(sensor.price),
					})),
			}

			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/installation-settings`,
				{
					method: 'PUT',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(payload),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(
					data?.detail || 'Не удалось сохранить параметры установки',
				)
			}

			setSource(data?.source || 'OWN')
			setInheritedFromName(null)
			setUpdatedAt(data?.settings?.updated_at || null)
			setNotice('Параметры сохранены')

			if (onSaved) onSaved(data)
		} catch (err) {
			setError(err.message)
		} finally {
			setSaving(false)
		}
	}

	const handleReset = async () => {
		const confirmText =
			'Сбросить собственные параметры этого клиента?\n\n' +
			'После сброса он снова будет брать параметры родителя, ' +
			'а если родителя нет — будет считаться ненастроенным.'

		if (!window.confirm(confirmText)) return

		setSaving(true)
		setError('')
		setNotice('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/installation-settings`,
				{
					method: 'DELETE',
					headers: getAuthHeaders(),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось сбросить параметры')
			}

			const loaded = data?.settings
			const trackers = gpsTrackerItems

			setSource(data?.source || 'NONE')
			setInheritedFromName(data?.inherited_from_client_name || null)
			setUpdatedAt(loaded?.updated_at || null)

			if (loaded) {
				setForm({
					visit_type: loaded.visit_type || '',
					visit_price_code: loaded.visit_price_code || 'ON_SITE_CITY',
					platform: loaded.platform || '',
					gps_price_code: loaded.gps_price_code || '',
					tracker_subscription_months: Number(
						loaded.tracker_subscription_months || 0,
					),
					has_blocking: Boolean(loaded.has_blocking),
					has_beacon: Boolean(loaded.has_beacon),
					beacon_subscription_months: Number(
						loaded.beacon_subscription_months || 0,
					),
					vin_required: loaded.vin_required !== false,
					schedule_time_required: loaded.schedule_time_required !== false,
				})
			} else {
				setForm({ ...EMPTY_FORM, gps_price_code: trackers[0]?.code || '' })
			}

			setSensors(
				(data?.sensors || []).map(sensor => ({
					local_id: createLocalId(),
					name: sensor.name || '',
					price:
						sensor.price === null || sensor.price === undefined
							? ''
							: String(sensor.price),
				})),
			)

			setNotice('Собственные параметры сброшены')

			if (onSaved) onSaved(data)
		} catch (err) {
			setError(err.message)
		} finally {
			setSaving(false)
		}
	}

	const clientTitle =
		client?.company_name || client?.name || `Клиент #${clientId}`

	const renderBanner = () => {
		if (loading) return null

		if (source === 'INHERITED') {
			return (
				<div className='client-install-banner inherited'>
					<strong>Параметры унаследованы</strong>
					<span>
						Сейчас берутся от «{inheritedFromName || 'родительского клиента'}».
						{canManage
							? ' Если сохранить, у этого клиента появятся собственные параметры.'
							: ''}
					</span>
				</div>
			)
		}

		if (source === 'NONE') {
			return (
				<div className='client-install-banner none'>
					<strong>Параметры не настроены</strong>
					<span>
						Ни у клиента, ни у его родителя параметров нет. Значения ниже —
						предложение по умолчанию, они не сохранены.
					</span>
				</div>
			)
		}

		return (
			<div className='client-install-banner own'>
				<strong>Собственные параметры клиента</strong>
				<span>Последнее изменение: {formatDateTime(updatedAt)}</span>
			</div>
		)
	}

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='modal-window vehicle-modal-window client-install-modal-window'
				onClick={e => e.stopPropagation()}
			>
				<div className='modal-header'>
					<span className='modal-title'>
						Параметры установки — {clientTitle}
					</span>

					<button className='modal-close' type='button' onClick={onClose}>
						&times;
					</button>
				</div>

				{error && <div className='request-modal-error-banner'>{error}</div>}
				{notice && <div className='client-install-notice'>{notice}</div>}

				<div className='vehicle-modal-body'>
					{loading ? (
						<div className='client-install-empty'>Загрузка параметров...</div>
					) : (
						<>
							{renderBanner()}

							{!canManage && (
								<div className='client-install-banner readonly'>
									<strong>Только просмотр</strong>
									<span>
										У вас нет прав менять параметры установки этого клиента.
									</span>
								</div>
							)}

							<div className='vehicle-form-card'>
								<div className='vehicle-form-section-title'>
									Параметры заявки по умолчанию
								</div>

								<div className='vehicle-form-grid'>
									<label className='vehicle-field vehicle-full'>
										<span className='vehicle-label'>Формат работ</span>

										<div className='client-install-radio-list'>
											{[
												{ value: '', label: 'Не задан' },
												{ value: 'ON_SITE', label: 'Выезд к клиенту' },
												{ value: 'IN_OFFICE', label: 'В офисе' },
											].map(option => (
												<label
													key={option.value || 'none'}
													className={`client-install-radio ${
														form.visit_type === option.value ? 'active' : ''
													}`}
												>
													<input
														type='radio'
														name='visit_type'
														value={option.value}
														checked={form.visit_type === option.value}
														disabled={isReadOnly}
														onChange={e =>
															updateForm('visit_type', e.target.value)
														}
													/>
													{option.label}
												</label>
											))}
										</div>
									</label>

									{form.visit_type === 'ON_SITE' && (
										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label'>Тип выезда</span>

											<select
												className='vehicle-input'
												value={form.visit_price_code}
												disabled={isReadOnly}
												onChange={e =>
													updateForm('visit_price_code', e.target.value)
												}
											>
												{VISIT_PRICE_CODE_OPTIONS.map(option => (
													<option key={option.code} value={option.code}>
														{option.label}
													</option>
												))}
											</select>

											<span className='client-install-hint'>
												Командировка по километражу зависит от адреса и
												указывается при создании заявки.
											</span>
										</label>
									)}

									<label className='vehicle-field vehicle-full'>
										<span className='vehicle-label'>Платформа мониторинга</span>

										<select
											className='vehicle-input'
											value={form.platform}
											disabled={isReadOnly}
											onChange={e => updateForm('platform', e.target.value)}
										>
											<option value=''>Не задана</option>

											{PLATFORM_OPTIONS.map(platform => (
												<option key={platform} value={platform}>
													{platform}
												</option>
											))}
										</select>
									</label>

									<div className='vehicle-field vehicle-full'>
										<span className='vehicle-label'>
											VIN при создании заявки
										</span>

										<div className='client-install-radio-list'>
											{[
												{ value: true, label: 'Обязателен' },
												{ value: false, label: 'Можно указать позже' },
											].map(option => (
												<label
													key={String(option.value)}
													className={`client-install-radio ${
														form.vin_required === option.value ? 'active' : ''
													}`}
												>
													<input
														type='radio'
														name='vin_required'
														checked={form.vin_required === option.value}
														disabled={isReadOnly}
														onChange={() =>
															updateForm('vin_required', option.value)
														}
													/>
													{option.label}
												</label>
											))}
										</div>

										{form.vin_required ? (
											<span className='client-install-hint'>
												Обычный порядок: без VIN машину в заявку не добавить.
											</span>
										) : (
											<div
												className='client-install-banner none'
												style={{ marginTop: 10, marginBottom: 0 }}
											>
												<strong>VIN всё равно потребуется</strong>
												<span>
													Заявку можно будет создать без VIN, но привязать
													оборудование и завершить работы без VIN не получится:
													система не даст. VIN впишет монтажник на месте или
													ответственный менеджер.
												</span>
											</div>
										)}
									</div>

									<div className='vehicle-field vehicle-full'>
										<span className='vehicle-label'>
											Время работ при создании заявки
										</span>

										<div className='client-install-radio-list'>
											{[
												{ value: true, label: 'Клиент выбирает время' },
												{ value: false, label: 'Подставлять автоматически' },
											].map(option => (
												<label
													key={String(option.value)}
													className={`client-install-radio ${
														form.schedule_time_required === option.value
															? 'active'
															: ''
													}`}
												>
													<input
														type='radio'
														name='schedule_time_required'
														checked={
															form.schedule_time_required === option.value
														}
														disabled={isReadOnly}
														onChange={() =>
															updateForm('schedule_time_required', option.value)
														}
													/>
													{option.label}
												</label>
											))}
										</div>

										{form.schedule_time_required ? (
											<span className='client-install-hint'>
												Обычный порядок: клиент сам указывает дату и время работ
												в кабинете.
											</span>
										) : (
											<div
												className='client-install-banner none'
												style={{ marginTop: 10, marginBottom: 0 }}
											>
												<strong>Время подставится само</strong>
												<span>
													В кабинете клиента поля даты и времени не будет —
													останутся только город и адрес. При создании заявки
													система поставит ближайшее рабочее время с учётом
													запаса на дорогу: пн–пт, 10:00–17:30, шаг 30 минут.
													Диспетчер может передвинуть его как обычно.
												</span>
											</div>
										)}
									</div>
								</div>
							</div>

							<div className='vehicle-form-card'>
								<div className='vehicle-form-section-title'>
									Параметры установки
								</div>

								<div className='vehicle-form-grid'>
									<label className='vehicle-field vehicle-full'>
										<span className='vehicle-label'>Трекер</span>

										<select
											className='vehicle-input'
											value={form.gps_price_code}
											disabled={isReadOnly}
											onChange={e =>
												updateForm('gps_price_code', e.target.value)
											}
										>
											{gpsTrackerItems.map(item => (
												<option key={item.id} value={item.code}>
													{item.name}
												</option>
											))}

											<option value=''>Без GPS / только маяк</option>
										</select>
									</label>

									{form.gps_price_code && (
										<>
											<label className='vehicle-field vehicle-full'>
												<span className='vehicle-label'>
													Подписка трекера, мес.
												</span>

												<input
													className='vehicle-input'
													type='number'
													min='0'
													value={form.tracker_subscription_months}
													disabled={isReadOnly}
													onChange={e =>
														updateForm(
															'tracker_subscription_months',
															e.target.value,
														)
													}
												/>
											</label>

											<div className='vehicle-field vehicle-full'>
												<span className='vehicle-label'>Блокировка</span>

												<div className='client-install-radio-list'>
													{[
														{ value: true, label: 'С блокировкой' },
														{ value: false, label: 'Без блокировки' },
													].map(option => (
														<label
															key={String(option.value)}
															className={`client-install-radio ${
																form.has_blocking === option.value
																	? 'active'
																	: ''
															}`}
														>
															<input
																type='radio'
																name='has_blocking'
																checked={form.has_blocking === option.value}
																disabled={isReadOnly}
																onChange={() =>
																	updateForm('has_blocking', option.value)
																}
															/>
															{option.label}
														</label>
													))}
												</div>
											</div>
										</>
									)}

									<div className='vehicle-field vehicle-full'>
										<span className='vehicle-label'>Маяк</span>

										<div className='client-install-radio-list'>
											{[
												{ value: true, label: 'С маяком' },
												{ value: false, label: 'Без маяка' },
											].map(option => (
												<label
													key={String(option.value)}
													className={`client-install-radio ${
														form.has_beacon === option.value ? 'active' : ''
													}`}
												>
													<input
														type='radio'
														name='has_beacon'
														checked={form.has_beacon === option.value}
														disabled={isReadOnly}
														onChange={() =>
															updateForm('has_beacon', option.value)
														}
													/>
													{option.label}
												</label>
											))}
										</div>
									</div>

									{form.has_beacon && (
										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label'>
												Подписка маяка, мес.
											</span>

											<input
												className='vehicle-input'
												type='number'
												min='0'
												value={form.beacon_subscription_months}
												disabled={isReadOnly}
												onChange={e =>
													updateForm(
														'beacon_subscription_months',
														e.target.value,
													)
												}
											/>
										</label>
									)}
								</div>
							</div>

							<div className='vehicle-form-card'>
								<div className='client-install-sensors-header'>
									<div className='vehicle-form-section-title'>
										Дополнительные датчики по шаблону
									</div>

									{canManage && (
										<button
											type='button'
											className='client-install-add-sensor-btn'
											onClick={addSensor}
											disabled={saving}
										>
											+ Датчик
										</button>
									)}
								</div>

								<div className='client-install-hint'>
									Каждый датчик добавляется к <b>каждому автомобилю</b> заявки.
								</div>

								{sensors.length === 0 ? (
									<div className='client-install-empty'>
										Датчики по шаблону не заданы
									</div>
								) : (
									<div className='client-install-sensor-list'>
										{sensors.map(sensor => (
											<div
												key={sensor.local_id}
												className='client-install-sensor-row'
											>
												<label className='vehicle-field'>
													<span className='vehicle-label'>Название</span>

													<input
														className='vehicle-input'
														value={sensor.name}
														disabled={isReadOnly}
														placeholder='Имя датчика'
														onChange={e =>
															updateSensor(
																sensor.local_id,
																'name',
																e.target.value,
															)
														}
													/>
												</label>

												<label className='vehicle-field'>
													<span className='vehicle-label'>Цена, тг</span>

													<input
														className='vehicle-input'
														type='number'
														min='0'
														value={sensor.price}
														disabled={isReadOnly}
														placeholder='0'
														onChange={e =>
															updateSensor(
																sensor.local_id,
																'price',
																e.target.value,
															)
														}
													/>
												</label>

												{canManage && (
													<button
														type='button'
														className='client-install-sensor-remove'
														onClick={() => removeSensor(sensor.local_id)}
														disabled={saving}
														title='Убрать датчик'
													>
														×
													</button>
												)}
											</div>
										))}
									</div>
								)}
							</div>
						</>
					)}
				</div>

				<div className='modal-footer vehicle-modal-footer'>
					<button
						className='vehicle-cancel-btn'
						type='button'
						onClick={onClose}
						disabled={saving}
					>
						Закрыть
					</button>

					{canManage && source === 'OWN' && (
						<button
							className='vehicle-cancel-btn client-install-reset-btn'
							type='button'
							onClick={handleReset}
							disabled={saving || loading}
						>
							Сбросить
						</button>
					)}

					{canManage && (
						<button
							className='vehicle-submit-btn'
							type='button'
							onClick={handleSave}
							disabled={saving || loading}
						>
							{saving ? 'Сохранение...' : 'Сохранить параметры'}
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
