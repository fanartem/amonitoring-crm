import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import {
	VIN_MAX_LENGTH,
	getVinError,
	getVinWarning,
	normalizeVin,
} from '../utils/vin'
import '../styles/CompleteRequestModal.css'

/**
 * Окно завершения работ.
 *
 * Зачем отдельный компонент, а не window.confirm в Requests.jsx: то же самое
 * окно нужно из карточки заявок и из модалки деталей (после привязки
 * оборудования, не закрывая её). Логика одна, и жить в двух местах она
 * не должна.
 *
 * Что здесь происходит:
 *   1. Показываем, что именно завершаем — авто заявки, их VIN и оборудование.
 *   2. Если у части машин VIN не указан (клиент вроде ФортеБанка создаёт
 *      заявку без VIN — машину показывает поставщик уже на месте), даём
 *      вписать его прямо здесь. Каждый VIN сохраняется отдельным запросом
 *      POST /vehicles/{id}/vin, потому что там своя проверка занятости.
 *   3. Если тип работ «Установка» и к какой-то машине не привязано
 *      оборудование — завершить нельзя. Сервер откажет всё равно, но лучше
 *      сказать об этом до нажатия, а не после.
 *
 * Почему у VIN своя кнопка «Сохранить VIN», отдельная от завершения:
 * без неё получался замкнутый круг. Оборудование не привязать, пока нет
 * VIN; завершение заблокировано, пока нет оборудования; а VIN сохранялся
 * только при завершении. Теперь порядок нормальный: сохранил VIN →
 * привязал оборудование → завершил.
 *
 * Данные заявки окно перечитывает само при каждом открытии, а не берёт
 * из props. Родитель отдаёт снимок: в списке заявок он обновляется раз
 * в 10 секунд, а в модалке деталей — вообще только при открытии, поэтому
 * оборудование, привязанное минуту назад на соседней вкладке, окно
 * не увидело бы и отказало бы в завершении по несуществующей причине.
 *
 * Проверки продублированы с сервером не «на всякий случай», а чтобы монтажник
 * увидел проблему в одном окне вместе с полями для её решения. Последнее слово
 * всё равно за /requests/{id}/complete.
 */

const hasVin = vehicle => Boolean(String(vehicle?.vin || '').trim())

const hasEquipment = vehicle =>
	Array.isArray(vehicle?.equipment) && vehicle.equipment.length > 0

const getVehicleLabel = (vehicle, index) => {
	const title = `${vehicle?.brand || ''} ${vehicle?.model || ''}`.trim()
	const plate = String(vehicle?.plate_number || '').trim()

	const parts = [`Авто ${index + 1}`]

	if (title) parts.push(title)
	if (plate) parts.push(plate)

	return parts.join(' · ')
}

const readError = async (res, fallback) => {
	try {
		const data = await res.json()

		if (typeof data?.detail === 'string') return data.detail

		return fallback
	} catch {
		return fallback
	}
}

export default function CompleteRequestModal({
	isOpen,
	request,
	onClose,
	onCompleted,
	onUpdated,
	onOpenEquipment,
}) {
	const [vinDrafts, setVinDrafts] = useState({})
	const [vinErrors, setVinErrors] = useState({})
	const [savedVehicleIds, setSavedVehicleIds] = useState([])
	const [savingVins, setSavingVins] = useState(false)
	const [vinNotice, setVinNotice] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState('')

	// Свежая заявка с сервера и счётчик перезагрузок: его дёргаем после
	// сохранения VIN, чтобы окно сразу показало новое состояние.
	const [liveRequest, setLiveRequest] = useState(null)
	const [loadingRequest, setLoadingRequest] = useState(false)
	const [refreshToken, setRefreshToken] = useState(0)

	const requestId = request?.id || null

	// Сбрасываем состояние на каждое открытие: чужие черновики VIN
	// от прошлой заявки здесь опаснее пустых полей.
	useEffect(() => {
		if (!isOpen) return

		setVinDrafts({})
		setVinErrors({})
		setSavedVehicleIds([])
		setSavingVins(false)
		setVinNotice('')
		setSubmitting(false)
		setError('')
		setLiveRequest(null)
		setRefreshToken(0)
	}, [isOpen, requestId])

	// Перечитываем заявку при открытии и после сохранения VIN.
	// Если запрос не удался — молча продолжаем на данных из props:
	// показать окно со старыми данными лучше, чем не показать вовсе,
	// а последнее слово всё равно за сервером при завершении.
	useEffect(() => {
		if (!isOpen || !requestId) return

		let cancelled = false

		const loadRequest = async () => {
			setLoadingRequest(true)

			try {
				const res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
					headers: getAuthHeaders(),
				})

				if (!res.ok) return

				const data = await res.json()

				if (!cancelled) setLiveRequest(data?.request || null)
			} catch {
				// офлайн или сеть моргнула — остаёмся на снимке из props
			} finally {
				if (!cancelled) setLoadingRequest(false)
			}
		}

		loadRequest()

		return () => {
			cancelled = true
		}
	}, [isOpen, requestId, refreshToken])

	// Свежие данные важнее снимка из props — но только когда они уже приехали.
	const effectiveRequest = liveRequest || request

	const vehicles = useMemo(
		() => effectiveRequest?.vehicles || [],
		[effectiveRequest],
	)

	const isInstallation =
		String(effectiveRequest?.work_type || '') === 'INSTALLATION'

	// Машины, у которых VIN не указан и ещё не сохранён в этом окне.
	const vehiclesWithoutVin = useMemo(
		() =>
			vehicles
				.map((vehicle, index) => ({ vehicle, index }))
				.filter(
					({ vehicle }) =>
						!hasVin(vehicle) &&
						!savedVehicleIds.includes(Number(vehicle.vehicle_id)),
				),
		[vehicles, savedVehicleIds],
	)

	// Оборудование требуем только на установке — на диагностике и снятии
	// привязывать нечего.
	const vehiclesWithoutEquipment = useMemo(
		() =>
			isInstallation
				? vehicles
						.map((vehicle, index) => ({ vehicle, index }))
						.filter(({ vehicle }) => !hasEquipment(vehicle))
				: [],
		[vehicles, isInstallation],
	)

	const equipmentBlocks = vehiclesWithoutEquipment.length > 0

	// Что сейчас введено в поля VIN: заполненные, из них корректные.
	const vinDraftState = useMemo(() => {
		const filled = []
		const invalid = []

		vehiclesWithoutVin.forEach(({ vehicle }) => {
			const vehicleId = Number(vehicle.vehicle_id)
			const vin = normalizeVin(vinDrafts[vehicleId])

			if (!vin) return

			filled.push({ vehicleId, vin })

			const error = getVinError(vin)

			if (error) invalid.push({ vehicleId, vin, error })
		})

		return { filled, invalid }
	}, [vehiclesWithoutVin, vinDrafts])

	// Кнопка «Сохранить VIN» доступна, когда есть хотя бы один полный VIN
	// и ни одного недописанного. Требовать заполнить сразу все машины
	// нельзя: монтажник может стоять у первой и не видеть вторую.
	const canSaveVins =
		!savingVins &&
		!submitting &&
		!loadingRequest &&
		vinDraftState.filled.length > 0 &&
		vinDraftState.invalid.length === 0

	if (!isOpen || !request) return null

	const updateVin = (vehicleId, value) => {
		setVinDrafts(prev => ({
			...prev,
			[vehicleId]: normalizeVin(value),
		}))

		setVinNotice('')

		setVinErrors(prev => {
			if (!prev[vehicleId]) return prev

			const next = { ...prev }

			delete next[vehicleId]

			return next
		})
	}

	const saveVinRequest = async (vehicleId, vin) => {
		const res = await fetch(`${API_BASE_URL}/vehicles/${vehicleId}/vin`, {
			method: 'POST',
			headers: getJsonAuthHeaders(),
			body: JSON.stringify({
				vin,
				request_id: requestId,
			}),
		})

		if (!res.ok) {
			throw new Error(await readError(res, 'Не удалось сохранить VIN'))
		}

		return res.json()
	}

	/**
	 * Сохраняет введённые VIN, ничего не завершая.
	 *
	 * Возвращает true, если сохранились все. Этим же пользуется завершение:
	 * там сначала должны уехать VIN, иначе сервер откажет.
	 */
	const saveVins = async () => {
		const nextErrors = {}
		const seen = new Map()

		// Дубли внутри одной заявки ловим здесь: сервер вернул бы их
		// по одному, и монтажник исправлял бы в три захода.
		vinDraftState.filled.forEach(({ vehicleId, vin }) => {
			if (seen.has(vin)) {
				nextErrors[vehicleId] = 'Этот VIN уже введён для другой машины заявки'
				return
			}

			seen.set(vin, vehicleId)
		})

		vinDraftState.invalid.forEach(({ vehicleId, error }) => {
			nextErrors[vehicleId] = error
		})

		if (Object.keys(nextErrors).length > 0) {
			setVinErrors(nextErrors)
			return false
		}

		setVinErrors({})
		setSavingVins(true)

		const savedNow = []

		try {
			// По одному и с запоминанием успешных: если третий окажется
			// дублем чужой машины, первые два переписывать не придётся.
			for (const { vehicleId, vin } of vinDraftState.filled) {
				try {
					await saveVinRequest(vehicleId, vin)
					savedNow.push(vehicleId)
				} catch (err) {
					setVinErrors(prev => ({ ...prev, [vehicleId]: err.message }))
					return false
				}
			}

			return true
		} finally {
			setSavingVins(false)

			if (savedNow.length > 0) {
				setSavedVehicleIds(prev => [...prev, ...savedNow])
				setRefreshToken(prev => prev + 1)
				onUpdated?.()
			}
		}
	}

	const handleSaveVins = async () => {
		setError('')
		setVinNotice('')

		const saved = await saveVins()

		if (!saved) return

		setVinNotice(
			isInstallation
				? 'VIN сохранены. Теперь можно привязать оборудование.'
				: 'VIN сохранены.',
		)
	}

	const handleSubmit = async () => {
		if (equipmentBlocks) return

		setError('')

		// Незаписанные VIN уезжают первыми — без них сервер откажет.
		if (vehiclesWithoutVin.length > 0) {
			if (vinDraftState.filled.length < vehiclesWithoutVin.length) {
				setError('Укажите VIN для всех машин заявки.')

				const nextErrors = {}

				vehiclesWithoutVin.forEach(({ vehicle }) => {
					const vehicleId = Number(vehicle.vehicle_id)

					if (!normalizeVin(vinDrafts[vehicleId])) {
						nextErrors[vehicleId] = 'Укажите VIN'
					}
				})

				setVinErrors(prev => ({ ...prev, ...nextErrors }))

				return
			}

			const saved = await saveVins()

			if (!saved) {
				setError('VIN сохранены не все — исправьте отмеченное поле.')
				return
			}
		}

		setSubmitting(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/requests/${requestId}/complete`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
				},
			)

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось завершить заявку'))
			}

			onCompleted?.()
		} catch (err) {
			setError(err.message)
			setSubmitting(false)

			// VIN мог сохраниться, а завершение — упасть. Обновляем данные,
			// чтобы вписанный VIN не пропал с экрана.
			onUpdated?.()
		}
	}

	const handleGoToEquipment = () => {
		onOpenEquipment?.(effectiveRequest)
	}

	return (
		<div
			className='crm-modal-overlay'
			onMouseDown={submitting || savingVins ? undefined : onClose}
		>
			<div
				className='crm-modal crm-complete-modal'
				onMouseDown={e => e.stopPropagation()}
			>
				<div className='crm-modal-header'>
					<div>
						<div className='crm-modal-title'>Завершение работ</div>
						<div className='crm-modal-subtitle'>Заявка №{requestId}</div>
					</div>

					<button
						type='button'
						className='crm-modal-close'
						onClick={onClose}
						disabled={submitting || savingVins}
					>
						×
					</button>
				</div>

				<div className='crm-modal-body'>
					{loadingRequest && !liveRequest && (
						<div className='crm-complete-loading'>
							Проверяем актуальные данные заявки…
						</div>
					)}

					{vehiclesWithoutVin.length > 0 && (
						<div className='crm-complete-section'>
							<div className='crm-complete-section-title'>
								Укажите VIN
								<span className='crm-complete-section-count'>
									{vehiclesWithoutVin.length} шт.
								</span>
							</div>

							<div className='crm-alert crm-alert-warn'>
								У этих машин VIN не был известен при создании заявки. Впишите
								его с таблички или со стекла и сохраните — до этого оборудование
								к машине не привязать, а заявку не закрыть. Обычно в VIN 17
								символов; у спецтехники бывает номер рамы другой длины — такой
								тоже примем.
							</div>

							{vehiclesWithoutVin.map(({ vehicle, index }) => {
								const vehicleId = Number(vehicle.vehicle_id)
								const draft = normalizeVin(vinDrafts[vehicleId])
								const draftError = draft ? getVinError(draft) : ''
								const draftWarning = getVinWarning(draft)

								return (
									<div
										className='crm-complete-vin-row'
										key={vehicle.request_vehicle_id || index}
									>
										<div className='crm-complete-vin-label'>
											{getVehicleLabel(vehicle, index)}
										</div>

										<div className='crm-complete-vin-field'>
											<input
												className={`crm-input crm-input-vin ${
													vinErrors[vehicleId] ? 'crm-input-error' : ''
												}`}
												value={vinDrafts[vehicleId] || ''}
												onChange={e => updateVin(vehicleId, e.target.value)}
												placeholder='17 символов'
												maxLength={VIN_MAX_LENGTH}
												disabled={submitting || savingVins}
												autoComplete='off'
												spellCheck={false}
											/>

											<span
												className={`crm-vin-counter ${
													draft && !draftError ? 'ok' : ''
												}`}
											>
												{draft.length}
											</span>
										</div>

										{vinErrors[vehicleId] ? (
											<div className='crm-field-error'>
												{vinErrors[vehicleId]}
											</div>
										) : (
											draftWarning && (
												<div className='crm-field-warning'>{draftWarning}</div>
											)
										)}
									</div>
								)
							})}

							<div className='crm-complete-vin-actions'>
								<button
									type='button'
									className='crm-btn crm-btn-primary'
									onClick={handleSaveVins}
									disabled={!canSaveVins}
								>
									{savingVins ? 'Сохраняем…' : 'Сохранить VIN'}
								</button>

								{!canSaveVins && !savingVins && (
									<span className='crm-complete-vin-hint'>
										{vinDraftState.filled.length === 0
											? 'Впишите VIN хотя бы одной машины — латинские буквы и цифры.'
											: vinDraftState.invalid[0]?.error ||
												'Проверьте введённый VIN.'}
									</span>
								)}
							</div>
						</div>
					)}

					{vinNotice && (
						<div className='crm-alert crm-alert-success'>{vinNotice}</div>
					)}

					{equipmentBlocks && (
						<div className='crm-alert crm-alert-error'>
							<div className='crm-alert-title'>Не привязано оборудование</div>

							<div className='crm-alert-text'>
								По установке к каждой машине должно быть привязано хотя бы одно
								оборудование. Без этого заявку не завершить — иначе склад не
								сойдётся, и потом никто не найдёт, что и куда поставили.
							</div>

							<ul className='crm-alert-list'>
								{vehiclesWithoutEquipment.map(({ vehicle, index }) => (
									<li key={vehicle.request_vehicle_id || index}>
										{getVehicleLabel(vehicle, index)}
										{!hasVin(vehicle) &&
											!savedVehicleIds.includes(Number(vehicle.vehicle_id)) && (
												<span> — сначала сохраните VIN</span>
											)}
									</li>
								))}
							</ul>

							{onOpenEquipment && (
								<button
									type='button'
									className='crm-btn crm-btn-light'
									onClick={handleGoToEquipment}
								>
									Перейти к оборудованию
								</button>
							)}
						</div>
					)}

					<div className='crm-complete-section'>
						<div className='crm-complete-section-title'>
							Автомобили заявки
							<span className='crm-complete-section-count'>
								{vehicles.length} шт.
							</span>
						</div>

						{vehicles.length === 0 ? (
							<div className='crm-complete-empty'>Авто не указаны</div>
						) : (
							vehicles.map((vehicle, index) => {
								const vehicleId = Number(vehicle.vehicle_id)
								const vinSaved = savedVehicleIds.includes(vehicleId)
								const vinKnown = hasVin(vehicle) || vinSaved

								return (
									<div
										className='crm-complete-vehicle'
										key={vehicle.request_vehicle_id || index}
									>
										<div className='crm-complete-vehicle-title'>
											{getVehicleLabel(vehicle, index)}
										</div>

										<div className='crm-complete-vehicle-tags'>
											{vinKnown ? (
												<span className='crm-tag crm-tag-ok'>
													VIN{' '}
													{String(vehicle.vin || '').trim() ||
														normalizeVin(vinDrafts[vehicleId])}
												</span>
											) : (
												<span className='crm-tag crm-tag-warn'>
													VIN не указан
												</span>
											)}

											{isInstallation &&
												(hasEquipment(vehicle) ? (
													<span className='crm-tag crm-tag-ok'>
														Оборудование: {vehicle.equipment.length}
													</span>
												) : (
													<span className='crm-tag crm-tag-danger'>
														Без оборудования
													</span>
												))}
										</div>
									</div>
								)
							})
						)}
					</div>

					{error && <div className='crm-alert crm-alert-error'>{error}</div>}
				</div>

				<div className='crm-modal-footer'>
					<button
						type='button'
						className='crm-btn crm-btn-light'
						onClick={onClose}
						disabled={submitting || savingVins}
					>
						Отмена
					</button>

					<button
						type='button'
						className='crm-btn crm-btn-primary'
						onClick={handleSubmit}
						disabled={
							submitting || savingVins || loadingRequest || equipmentBlocks
						}
					>
						{submitting ? 'Завершаем…' : 'Завершить работы'}
					</button>
				</div>
			</div>
		</div>
	)
}
