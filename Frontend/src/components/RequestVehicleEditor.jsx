import React, { useEffect, useState } from 'react'
import { API_BASE_URL, getJsonAuthHeaders } from '../api'
import {
	VIN_MAX_LENGTH,
	getVinError,
	getVinWarning,
	normalizeVin,
} from '../utils/vin'

/**
 * Редактирование машины прямо в карточке заявки.
 *
 * Зачем: сейчас, чтобы поправить только что созданное авто, надо уйти
 * в карточку клиента и найти там машину среди сотен. При этом ошибку
 * замечают именно в заявке — марку, госномер или год.
 *
 * Два режима, и выбирает их не этот компонент, а сервер:
 *
 *   canEditVehicle  — есть право редактировать машины этого клиента
 *                     (флаг can_edit_vehicles заявки). Открываются все
 *                     поля, сохранение идёт через PATCH /vehicles/{id}.
 *
 *   canFillVin      — есть только «Машины: указать недостающий VIN»
 *                     (флаг can_fill_vehicle_vin). Открывается одно поле
 *                     VIN и только у машины, где он пустой; сохранение
 *                     идёт через POST /vehicles/{id}/vin, который знает
 *                     про «своя заявка» и не требует прав на клиента.
 *
 * Права считает бэкенд и отдаёт готовыми флагами — те же соображения,
 * что и для can_edit / can_complete: списки кодов на фронте расходятся
 * молча.
 */

const VEHICLE_TYPE_OPTIONS = ['Легковая', 'Электромобиль', 'Спецтехника']

const readError = async (res, fallback) => {
	try {
		const data = await res.json()

		if (typeof data?.detail === 'string') return data.detail

		return fallback
	} catch {
		return fallback
	}
}

const buildForm = vehicle => ({
	brand: vehicle?.brand || '',
	model: vehicle?.model || '',
	plate_number: vehicle?.plate_number || '',
	year: vehicle?.year ? String(vehicle.year) : '',
	type: vehicle?.vehicle_type || vehicle?.type || '',
	vin: vehicle?.vin || '',
})

export default function RequestVehicleEditor({
	vehicle,
	requestId,
	canEditVehicle,
	canFillVin,
	onSaved,
	onCancel,
}) {
	const [form, setForm] = useState(() => buildForm(vehicle))
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')

	const vehicleId = Number(vehicle?.vehicle_id || vehicle?.id)
	const originalVin = String(vehicle?.vin || '').trim()
	const vinWasEmpty = !originalVin

	// Заявка обновляется по таймеру; если машина в ней изменилась,
	// подставляем свежие значения, пока пользователь ничего не трогал.
	useEffect(() => {
		setForm(buildForm(vehicle))
		setError('')
	}, [vehicleId]) // eslint-disable-line react-hooks/exhaustive-deps

	// VIN-only: право есть только на заполнение недостающего VIN.
	const vinOnly = !canEditVehicle

	// Уже указанный VIN этой формой не меняют никогда. В полном режиме
	// его правит PATCH /vehicles/{id} — но там своя проверка дублей,
	// и делать это мимоходом при исправлении опечатки в модели опасно.
	const vinEditable = canEditVehicle || (canFillVin && vinWasEmpty)

	const vinDraft = normalizeVin(form.vin)
	const vinChanged = vinEditable && vinDraft !== normalizeVin(originalVin)
	const vinError = vinChanged ? getVinError(vinDraft) : ''
	const vinWarning = vinChanged ? getVinWarning(vinDraft) : ''

	const updateField = (field, value) => {
		setForm(prev => ({ ...prev, [field]: value }))
		setError('')
	}

	const yearNumber = form.year ? Number(form.year) : null

	const yearError =
		form.year &&
		(Number.isNaN(yearNumber) || yearNumber < 1900 || yearNumber > 2100)
			? 'Некорректный год выпуска'
			: ''

	const requiredError =
		!vinOnly && (!form.brand.trim() || !form.model.trim())
			? 'Марка и модель обязательны'
			: ''

	const canSave = vinOnly
		? Boolean(vinChanged) && !vinError && !saving
		: !vinError && !yearError && !requiredError && !saving

	const saveVinOnly = async () => {
		const res = await fetch(`${API_BASE_URL}/vehicles/${vehicleId}/vin`, {
			method: 'POST',
			headers: getJsonAuthHeaders(),
			body: JSON.stringify({
				vin: vinDraft,
				request_id: requestId,
			}),
		})

		if (!res.ok) {
			throw new Error(await readError(res, 'Не удалось сохранить VIN'))
		}
	}

	const saveVehicle = async () => {
		// Шлём только изменённое: PATCH принимает частичный набор,
		// и лишние поля — это лишние записи в истории клиента.
		const payload = {}

		const textFields = [
			['brand', vehicle?.brand || ''],
			['model', vehicle?.model || ''],
			['plate_number', vehicle?.plate_number || ''],
			['type', vehicle?.vehicle_type || vehicle?.type || ''],
		]

		textFields.forEach(([field, original]) => {
			const value = String(form[field] || '').trim()

			if (value !== String(original || '').trim()) {
				payload[field] = value || null
			}
		})

		const originalYear = vehicle?.year ? Number(vehicle.year) : null

		if (yearNumber !== originalYear) {
			payload.year = yearNumber
		}

		if (vinChanged) {
			payload.vin = vinDraft
		}

		if (Object.keys(payload).length === 0) {
			return
		}

		const res = await fetch(`${API_BASE_URL}/vehicles/${vehicleId}`, {
			method: 'PATCH',
			headers: getJsonAuthHeaders(),
			body: JSON.stringify(payload),
		})

		if (!res.ok) {
			throw new Error(await readError(res, 'Не удалось сохранить машину'))
		}
	}

	const handleSave = async () => {
		if (!canSave) return

		setSaving(true)
		setError('')

		try {
			if (vinOnly) {
				await saveVinOnly()
			} else {
				await saveVehicle()
			}

			onSaved?.()
		} catch (err) {
			setError(err.message)
		} finally {
			setSaving(false)
		}
	}

	const typeOptions = VEHICLE_TYPE_OPTIONS.includes(form.type)
		? VEHICLE_TYPE_OPTIONS
		: [form.type, ...VEHICLE_TYPE_OPTIONS].filter(Boolean)

	return (
		<div className='vehicle-editor'>
			{!vinOnly && (
				<div className='vehicle-editor-grid'>
					<label className='vehicle-editor-field'>
						<span className='vehicle-editor-label'>Марка</span>
						<input
							className='vehicle-editor-input'
							value={form.brand}
							onChange={e => updateField('brand', e.target.value)}
							disabled={saving}
						/>
					</label>

					<label className='vehicle-editor-field'>
						<span className='vehicle-editor-label'>Модель</span>
						<input
							className='vehicle-editor-input'
							value={form.model}
							onChange={e => updateField('model', e.target.value)}
							disabled={saving}
						/>
					</label>

					<label className='vehicle-editor-field'>
						<span className='vehicle-editor-label'>Гос. номер</span>
						<input
							className='vehicle-editor-input'
							value={form.plate_number}
							onChange={e => updateField('plate_number', e.target.value)}
							placeholder='б/н'
							disabled={saving}
						/>
					</label>

					<label className='vehicle-editor-field'>
						<span className='vehicle-editor-label'>Год выпуска</span>
						<input
							className='vehicle-editor-input'
							value={form.year}
							onChange={e =>
								updateField('year', e.target.value.replace(/[^0-9]/g, ''))
							}
							maxLength={4}
							inputMode='numeric'
							disabled={saving}
						/>
					</label>

					<label className='vehicle-editor-field'>
						<span className='vehicle-editor-label'>Тип техники</span>
						<select
							className='vehicle-editor-input'
							value={form.type}
							onChange={e => updateField('type', e.target.value)}
							disabled={saving}
						>
							<option value=''>Не указан</option>

							{typeOptions.map(option => (
								<option key={option} value={option}>
									{option}
								</option>
							))}
						</select>
					</label>
				</div>
			)}

			<div className='vehicle-editor-field vehicle-editor-vin'>
				<span className='vehicle-editor-label'>VIN-код</span>

				{vinEditable ? (
					<input
						className='vehicle-editor-input vehicle-editor-input-vin'
						value={form.vin}
						onChange={e => updateField('vin', normalizeVin(e.target.value))}
						placeholder='Обычно 17 символов'
						maxLength={VIN_MAX_LENGTH}
						disabled={saving}
						autoComplete='off'
						spellCheck={false}
					/>
				) : (
					<div className='vehicle-editor-static'>
						{originalVin || '—'}
						<span className='vehicle-editor-static-note'>
							Указанный VIN меняет только менеджер в карточке клиента
						</span>
					</div>
				)}

				{vinError ? (
					<div className='vehicle-editor-error'>{vinError}</div>
				) : (
					vinWarning && (
						<div className='vehicle-editor-warning'>{vinWarning}</div>
					)
				)}
			</div>

			{yearError && <div className='vehicle-editor-error'>{yearError}</div>}
			{requiredError && (
				<div className='vehicle-editor-error'>{requiredError}</div>
			)}
			{error && <div className='vehicle-editor-error'>{error}</div>}

			{vinOnly && (
				<div className='vehicle-editor-note'>
					У вас есть право указать недостающий VIN. Остальные поля машины меняет
					менеджер клиента.
				</div>
			)}

			<div className='vehicle-editor-actions'>
				<button
					type='button'
					className='vehicle-editor-btn'
					onClick={onCancel}
					disabled={saving}
				>
					Отмена
				</button>

				<button
					type='button'
					className='vehicle-editor-btn primary'
					onClick={handleSave}
					disabled={!canSave}
				>
					{saving ? 'Сохраняем…' : 'Сохранить'}
				</button>
			</div>
		</div>
	)
}
