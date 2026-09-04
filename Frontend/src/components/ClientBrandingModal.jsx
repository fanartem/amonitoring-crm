import React, { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import {
	DEFAULT_BASE_COLOR,
	buildPortalTheme,
	getThemeContrastReport,
	getThemeWarnings,
	normalizeHexColor,
} from '../utils/portalTheme'
import '../styles/ClientBrandingModal.css'

/*
 * Оформление кабинета клиента.
 *
 * Выбирается ОДИН цвет, всё остальное считается из него.
 * Поэтому главный элемент окна — не поля, а предпросмотр: человек должен
 * увидеть, что получилось, до того как это увидит клиент.
 *
 * Предпросмотр считается тем же portalTheme.js, что красит настоящий
 * кабинет. Это не «похожая картинка», а тот же расчёт на тех же данных.
 */

// Не палитра на выбор, а быстрые заготовки: фирменные цвета обычно
// приходят в виде hex от клиента, а эти — чтобы посмотреть, как ведёт
// себя расчёт, и для клиентов без явных требований.
const COLOR_PRESETS = [
	{ color: '#81b836', label: 'Наш зелёный' },
	{ color: '#1e4b9c', label: 'Синий' },
	{ color: '#003366', label: 'Тёмно-синий' },
	{ color: '#d64545', label: 'Красный' },
	{ color: '#7a5a00', label: 'Охра' },
	{ color: '#00838f', label: 'Бирюзовый' },
	{ color: '#5b3fa8', label: 'Фиолетовый' },
	{ color: '#111827', label: 'Графит' },
]

const formatFileSize = bytes => {
	const size = Number(bytes || 0)

	if (size < 1024) return `${size} Б`
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`

	return `${(size / 1024 / 1024).toFixed(1)} МБ`
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

export default function ClientBrandingModal({
	isOpen,
	client,
	onClose,
	onSaved,
}) {
	const clientId = client?.id || null
	const fileInputRef = useRef(null)

	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [error, setError] = useState('')
	const [notice, setNotice] = useState('')

	const [canManage, setCanManage] = useState(false)
	const [isConfigured, setIsConfigured] = useState(false)
	const [updatedAt, setUpdatedAt] = useState(null)

	const [isEnabled, setIsEnabled] = useState(true)
	const [baseColor, setBaseColor] = useState('')
	const [logo, setLogo] = useState(null)

	const [maxLogoSize, setMaxLogoSize] = useState(512 * 1024)

	const clientTitle =
		client?.company_name || client?.name || (clientId ? `#${clientId}` : '')

	const applyPayload = payload => {
		setCanManage(Boolean(payload?.can_manage))
		setIsConfigured(Boolean(payload?.is_configured))
		setIsEnabled(payload?.is_configured ? Boolean(payload.is_enabled) : true)
		setBaseColor(payload?.base_color || '')
		setLogo(payload?.logo || null)
		setUpdatedAt(payload?.updated_at || null)

		if (payload?.max_logo_size_bytes) {
			setMaxLogoSize(Number(payload.max_logo_size_bytes))
		}
	}

	useEffect(() => {
		if (!isOpen || !clientId) return

		let cancelled = false

		const load = async () => {
			setLoading(true)
			setError('')
			setNotice('')

			try {
				const res = await fetch(
					`${API_BASE_URL}/clients/${clientId}/branding`,
					{ headers: getAuthHeaders() },
				)

				if (!res.ok) {
					const data = await res.json().catch(() => null)
					throw new Error(
						data?.detail || 'Не удалось загрузить оформление кабинета',
					)
				}

				const payload = await res.json()

				if (cancelled) return

				applyPayload(payload)
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

	// Цвет предпросмотра: выбранный, а если не выбран — тот, с которого
	// кабинет выглядит как сегодня. Показывать пустой макет было бы
	// честно, но бесполезно.
	const previewColor = normalizeHexColor(baseColor) || DEFAULT_BASE_COLOR

	const themeStyle = useMemo(() => {
		const theme = buildPortalTheme(previewColor)
		const style = {}

		Object.entries(theme).forEach(([key, value]) => {
			if (key.startsWith('--')) style[key] = value
		})

		return style
	}, [previewColor])

	const warnings = useMemo(
		() => (baseColor ? getThemeWarnings(previewColor) : []),
		[baseColor, previewColor],
	)

	const contrastReport = useMemo(
		() => getThemeContrastReport(previewColor),
		[previewColor],
	)

	const hasContrastProblem = contrastReport.some(row => !row.passes)

	if (!isOpen) return null

	const isBusy = loading || saving || uploading
	const isReadOnly = !canManage || isBusy

	const handleColorInput = value => {
		setNotice('')
		setError('')
		setBaseColor(value)
	}

	const handleSave = async () => {
		if (!canManage) return

		const normalized = normalizeHexColor(baseColor)

		if (baseColor && !normalized) {
			setError('Цвет должен быть в формате #RRGGBB')
			return
		}

		setSaving(true)
		setError('')
		setNotice('')

		try {
			const res = await fetch(`${API_BASE_URL}/clients/${clientId}/branding`, {
				method: 'PUT',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					is_enabled: isEnabled,
					base_color: normalized,
				}),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось сохранить оформление')
			}

			applyPayload(data)
			setNotice('Оформление сохранено. Клиент увидит его при следующем входе.')

			onSaved?.()
		} catch (err) {
			setError(err.message)
		} finally {
			setSaving(false)
		}
	}

	const handleLogoSelected = async event => {
		const file = event.target.files?.[0]

		event.target.value = ''

		if (!file || !canManage) return

		if (file.size > maxLogoSize) {
			setError(
				`Логотип ${formatFileSize(file.size)} — больше ${formatFileSize(maxLogoSize)}. ` +
					'Для шапки достаточно файла в десятки килобайт.',
			)
			return
		}

		setUploading(true)
		setError('')
		setNotice('')

		try {
			const formData = new FormData()
			formData.append('file', file)

			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/branding/logo`,
				{
					method: 'POST',
					// Без Content-Type: boundary для multipart проставляет
					// браузер, руками его не задать.
					headers: getAuthHeaders(),
					body: formData,
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось загрузить логотип')
			}

			applyPayload(data)
			setNotice('Логотип загружен и уже сохранён.')

			onSaved?.()
		} catch (err) {
			setError(err.message)
		} finally {
			setUploading(false)
		}
	}

	const handleLogoDelete = async () => {
		if (!canManage || !logo) return

		if (!window.confirm('Удалить логотип? Кабинет вернётся к нашей шапке.')) {
			return
		}

		setUploading(true)
		setError('')
		setNotice('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/branding/logo`,
				{
					method: 'DELETE',
					headers: getAuthHeaders(),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось удалить логотип')
			}

			applyPayload(data)
			setNotice('Логотип удалён.')

			onSaved?.()
		} catch (err) {
			setError(err.message)
		} finally {
			setUploading(false)
		}
	}

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='modal-window vehicle-modal-window cb-modal-window'
				onClick={e => e.stopPropagation()}
			>
				<div className='modal-header'>
					<span className='modal-title'>
						Оформление кабинета — {clientTitle}
					</span>

					<button className='modal-close' type='button' onClick={onClose}>
						&times;
					</button>
				</div>

				{error && <div className='request-modal-error-banner'>{error}</div>}
				{notice && <div className='client-install-notice'>{notice}</div>}

				<div className='vehicle-modal-body cb-body'>
					{loading ? (
						<div className='cb-empty'>Загрузка оформления...</div>
					) : (
						<>
							{!canManage && (
								<div className='cb-banner readonly'>
									<strong>Только просмотр</strong>
									<span>
										У вас нет прав менять оформление кабинета этого клиента.
									</span>
								</div>
							)}

							<div className='cb-banner info'>
								<strong>Оформление не наследуется</strong>
								<span>
									Настройка действует только на этого клиента. Подклиентам
									оформление задаётся отдельно — их сотрудники входят в свои
									кабинеты и видят своё.
								</span>
							</div>

							{/* ---------- Выключатель ---------- */}

							<div className='cb-section'>
								<label className='cb-switch'>
									<input
										type='checkbox'
										checked={isEnabled}
										onChange={e => {
											setNotice('')
											setIsEnabled(e.target.checked)
										}}
										disabled={isReadOnly}
									/>

									<span>
										<strong>Показывать фирменное оформление</strong>
										<span className='cb-switch-hint'>
											Снятая галочка возвращает кабинету наш стандартный вид, но
											логотип и цвет остаются сохранёнными — на время
											ребрендинга или спора о логотипе.
										</span>
									</span>
								</label>
							</div>

							{/* ---------- Логотип ---------- */}

							<div className='cb-section'>
								<div className='cb-section-title'>Логотип</div>

								<div className='cb-logo-row'>
									<div className='cb-logo-preview'>
										{logo?.data_url ? (
											<img src={logo.data_url} alt='Логотип клиента' />
										) : (
											<span className='cb-logo-empty'>Логотип не загружен</span>
										)}
									</div>

									<div className='cb-logo-side'>
										<div className='cb-hint'>
											Горизонтальный логотип для шапки. PNG, JPG или WEBP, до{' '}
											{formatFileSize(maxLogoSize)}. Лучше PNG с прозрачным
											фоном и высотой около 80 пикселей — в шапке он
											масштабируется до 30.
										</div>

										{logo && (
											<div className='cb-logo-meta'>
												{logo.original_name} · {formatFileSize(logo.file_size)}
											</div>
										)}

										<input
											ref={fileInputRef}
											type='file'
											accept='.png,.jpg,.jpeg,.webp'
											style={{ display: 'none' }}
											onChange={handleLogoSelected}
										/>

										<div className='cb-logo-buttons'>
											<button
												type='button'
												className='cb-btn'
												onClick={() => fileInputRef.current?.click()}
												disabled={isReadOnly}
											>
												{uploading
													? 'Загрузка...'
													: logo
														? 'Заменить логотип'
														: 'Загрузить логотип'}
											</button>

											{logo && (
												<button
													type='button'
													className='cb-btn danger'
													onClick={handleLogoDelete}
													disabled={isReadOnly}
												>
													Удалить
												</button>
											)}
										</div>

										<div className='cb-hint quiet'>
											Логотип сохраняется сразу, отдельно от кнопки внизу.
										</div>
									</div>
								</div>
							</div>

							{/* ---------- Цвет ---------- */}

							<div className='cb-section'>
								<div className='cb-section-title'>Основной цвет</div>

								<div className='cb-hint'>
									Один цвет — им заливается шапка. Цвет надписей, фон меню,
									активный пункт, кнопки и рамки считаются из него так, чтобы
									всё осталось читаемым. Второй цвет выбирать не нужно и нельзя:
									пара цветов, подобранная руками, рано или поздно оказывается
									нечитаемой.
								</div>

								<div className='cb-color-row'>
									<input
										type='color'
										className='cb-color-input'
										value={previewColor}
										onChange={e => handleColorInput(e.target.value)}
										disabled={isReadOnly}
									/>

									<input
										type='text'
										className='cb-color-hex'
										value={baseColor}
										onChange={e => handleColorInput(e.target.value)}
										placeholder={DEFAULT_BASE_COLOR}
										maxLength={7}
										disabled={isReadOnly}
									/>

									{baseColor && (
										<button
											type='button'
											className='cb-link'
											onClick={() => handleColorInput('')}
											disabled={isReadOnly}
										>
											Убрать цвет
										</button>
									)}
								</div>

								<div className='cb-presets'>
									{COLOR_PRESETS.map(preset => (
										<button
											key={preset.color}
											type='button'
											className={`cb-preset ${
												normalizeHexColor(baseColor) === preset.color
													? 'active'
													: ''
											}`}
											style={{ background: preset.color }}
											title={`${preset.label} · ${preset.color}`}
											onClick={() => handleColorInput(preset.color)}
											disabled={isReadOnly}
										/>
									))}
								</div>

								{!baseColor && (
									<div className='cb-hint quiet'>
										Цвет не задан — кабинет выглядит стандартно. Ниже показано,
										как он выглядит сейчас.
									</div>
								)}

								{warnings.map(text => (
									<div key={text} className='cb-banner warn'>
										{text}
									</div>
								))}
							</div>

							{/* ---------- Предпросмотр ---------- */}

							<div className='cb-section'>
								<div className='cb-section-title'>Как это увидит клиент</div>

								<div className='cb-preview' style={themeStyle}>
									<div className='cb-preview-header'>
										<div className='cb-preview-brand'>
											{logo?.data_url ? (
												<img src={logo.data_url} alt='' />
											) : (
												<span className='cb-preview-logo-stub'>ЛОГОТИП</span>
											)}

											<span>Личный кабинет</span>
										</div>

										<div className='cb-preview-user'>
											Иванов И. · {clientTitle}
										</div>
									</div>

									<div className='cb-preview-body'>
										<div className='cb-preview-side'>
											<div className='cb-preview-nav active'>Заявки</div>
											<div className='cb-preview-nav'>Автомобили</div>
											<div className='cb-preview-nav'>Организации</div>
											<div className='cb-preview-nav'>Прайс</div>
											<div className='cb-preview-nav'>Профиль</div>
										</div>

										<div className='cb-preview-main'>
											<div className='cb-preview-soft'>
												Время работ по вашему договору назначаем мы. Заявка
												встанет на ближайшее рабочее время — пн–пт, 10:00–17:30.
											</div>

											<div className='cb-preview-card'>
												<div className='cb-preview-card-title'>
													Заявка №1043
												</div>
												<div className='cb-preview-card-meta'>
													Установка · 12.09.2026 11:30 · Алматы
												</div>

												<div className='cb-preview-actions'>
													<span className='cb-preview-btn'>Создать заявку</span>
													<span className='cb-preview-btn ghost'>Отмена</span>
													<span className='cb-preview-link'>
														Подробнее о заявке
													</span>
												</div>
											</div>
										</div>
									</div>
								</div>

								{/*
									Цифры контраста рядом с картинкой не для красоты:
									«нормально ли видно» на разных мониторах выглядит
									по-разному, а отношение контраста — одинаково.
								*/}
								<details className='cb-report'>
									<summary>
										Проверка читаемости
										{hasContrastProblem
											? ' — есть замечания'
											: ' — всё в норме'}
									</summary>

									<table>
										<tbody>
											{contrastReport.map(row => (
												<tr key={row.key}>
													<td>{row.label}</td>
													<td>
														<span
															className='cb-chip'
															style={{ background: row.foreground }}
														/>
														на
														<span
															className='cb-chip'
															style={{ background: row.background }}
														/>
													</td>
													<td className='cb-report-ratio'>
														{row.ratio.toFixed(2)}
													</td>
													<td className={row.passes ? 'cb-ok' : 'cb-bad'}>
														{row.passes ? 'читается' : 'плохо читается'}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</details>
							</div>

							{isConfigured && (
								<div className='cb-hint quiet'>
									Последнее изменение: {formatDateTime(updatedAt)}
								</div>
							)}
						</>
					)}
				</div>

				<div className='modal-footer vehicle-modal-footer'>
					<button
						className='vehicle-cancel-btn'
						type='button'
						onClick={onClose}
						disabled={saving || uploading}
					>
						Закрыть
					</button>

					{canManage && (
						<button
							className='vehicle-submit-btn'
							type='button'
							onClick={handleSave}
							disabled={isBusy}
						>
							{saving ? 'Сохранение...' : 'Сохранить оформление'}
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
