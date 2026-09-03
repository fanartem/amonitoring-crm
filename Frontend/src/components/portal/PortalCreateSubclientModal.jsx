import React, { useState } from 'react'
import { API_BASE_URL, getJsonAuthHeaders } from '../../api'
import './styles/PortalModal.css'

// Добавление организации в структуру клиента.
//
// Отдельный компонент, а не форма внутри страницы: ту же форму открывает
// модалка создания заявки, и держать её в двух местах — значит однажды
// поправить одно и забыть второе.
//
// Родителя выбрать нельзя: им всегда становится организация самого
// пользователя. Поля для него нет ни здесь, ни в схеме запроса.

const CLIENT_TYPES = [
	{ value: 'TOO', label: 'ТОО' },
	{ value: 'IP', label: 'ИП' },
	{ value: 'INDIVIDUAL', label: 'Физическое лицо' },
]

const EMPTY_FORM = {
	type: 'TOO',
	company_name: '',
	name: '',
	bin_iin: '',
	phone: '',
	email: '',
}

export default function PortalCreateSubclientModal({ onClose, onCreated }) {
	const [form, setForm] = useState(EMPTY_FORM)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')

	const isIndividual = form.type === 'INDIVIDUAL'

	const updateField = (field, value) => {
		setForm(prev => ({ ...prev, [field]: value }))
	}

	const validate = () => {
		if (!form.name.trim()) {
			return isIndividual ? 'Укажите ФИО' : 'Укажите ФИО контактного лица'
		}

		if (!form.phone.trim()) return 'Укажите контактный телефон'

		if (!isIndividual && !form.company_name.trim()) {
			return 'Укажите наименование организации'
		}

		if (!isIndividual && !form.bin_iin.trim()) {
			return 'Для ТОО и ИП БИН обязателен'
		}

		return ''
	}

	const handleSubmit = async e => {
		e.preventDefault()

		const validationError = validate()

		if (validationError) {
			setError(validationError)
			return
		}

		setSaving(true)
		setError('')

		try {
			const payload = {
				type: form.type,
				company_name: isIndividual ? null : form.company_name.trim(),
				name: form.name.trim(),
				bin_iin: form.bin_iin.trim() || null,
				phone: form.phone.trim(),
				email: form.email.trim() || null,
			}

			const res = await fetch(`${API_BASE_URL}/portal/subclients`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось добавить организацию')
			}

			onCreated(await res.json())
		} catch (err) {
			setError(err.message)
		} finally {
			setSaving(false)
		}
	}

	return (
		// Клик по затемнению окно не закрывает: введённое вручную не должно
		// теряться от промаха мимо формы.
		<div className='pm-overlay'>
			<div className='pm-window narrow'>
				<div className='pm-header'>
					<div>
						<div className='pm-header-title'>Новая организация</div>
						<div className='pm-header-subtitle'>
							Будет добавлена в вашу структуру
						</div>
					</div>

					<button className='pm-close' type='button' onClick={onClose}>
						&times;
					</button>
				</div>

				<form onSubmit={handleSubmit} style={{ display: 'contents' }}>
					<div className='pm-body'>
						{error && <div className='pm-banner error'>{error}</div>}

						<div className='pm-section'>
							<div className='pm-section-head'>
								<span className='pm-section-mark' />
								<span className='pm-section-title'>Реквизиты</span>
							</div>

							<div className='pm-section-body'>
								<div className='pm-grid pm-field'>
									<div className='pm-col'>
										<label className='pm-label'>
											Тип лица<span className='req'>*</span>
										</label>

										<select
											className='pm-select'
											value={form.type}
											onChange={e => updateField('type', e.target.value)}
										>
											{CLIENT_TYPES.map(item => (
												<option key={item.value} value={item.value}>
													{item.label}
												</option>
											))}
										</select>
									</div>

									<div className='pm-col'>
										<label className='pm-label'>
											{isIndividual ? 'ИИН' : 'БИН'}
											{!isIndividual && <span className='req'>*</span>}
										</label>

										<input
											className='pm-input'
											value={form.bin_iin}
											onChange={e =>
												updateField(
													'bin_iin',
													e.target.value.replace(/\D/g, ''),
												)
											}
											placeholder={isIndividual ? 'Если есть' : '12 цифр'}
										/>
									</div>
								</div>

								{!isIndividual && (
									<div className='pm-field'>
										<label className='pm-label'>
											Наименование организации<span className='req'>*</span>
										</label>

										<input
											className='pm-input'
											value={form.company_name}
											onChange={e =>
												updateField('company_name', e.target.value)
											}
											placeholder='«Пример»'
										/>
									</div>
								)}
							</div>
						</div>

						<div className='pm-section'>
							<div className='pm-section-head'>
								<span className='pm-section-mark' />
								<span className='pm-section-title'>Контакты</span>
							</div>

							<div className='pm-section-body'>
								<div className='pm-field'>
									<label className='pm-label'>
										{isIndividual ? 'ФИО' : 'ФИО контактного лица'}
										<span className='req'>*</span>
									</label>

									<input
										className='pm-input'
										value={form.name}
										onChange={e => updateField('name', e.target.value)}
									/>
								</div>

								<div className='pm-grid'>
									<div className='pm-col'>
										<label className='pm-label'>
											Контактный телефон<span className='req'>*</span>
										</label>

										<input
											className='pm-input'
											type='tel'
											value={form.phone}
											onChange={e => updateField('phone', e.target.value)}
											placeholder='+7 ___ ___ __ __'
										/>
									</div>

									<div className='pm-col'>
										<label className='pm-label'>Email</label>

										<input
											className='pm-input'
											type='email'
											value={form.email}
											onChange={e => updateField('email', e.target.value)}
											placeholder='Необязательно'
										/>
									</div>
								</div>

								<div className='pm-hint'>
									Условия обслуживания и ответственный менеджер перейдут от
									вашей организации. Параметры установки новая организация
									унаследует от вас, пока менеджер не задаст ей свои.
								</div>
							</div>
						</div>
					</div>

					<div className='pm-footer'>
						<button
							type='button'
							className='pm-btn'
							onClick={onClose}
							disabled={saving}
						>
							Отмена
						</button>

						<button type='submit' className='pm-btn primary' disabled={saving}>
							{saving ? 'Сохранение...' : 'Добавить организацию'}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
