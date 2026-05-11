import React, { useState, useEffect } from 'react'
import '../styles/Requests.css'
import '../styles/CreateClientModal.css'

const CLIENT_TYPES = {
	TOO: 'ТОО',
	IP: 'ИП',
	INDIVIDUAL: 'Физ. лицо',
}

export default function CreateClientModal({
	isOpen,
	onClose,
	onCreated,
	editClient,
}) {
	const isEditMode = !!editClient

	const [formData, setFormData] = useState({
		type: 'TOO',
		name: '',
		company_name: '',
		phone: '',
		email: '',
	})

	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (!isOpen) return

		if (isEditMode) {
			setFormData({
				type: editClient.type || 'TOO',
				name: editClient.name || '',
				company_name: editClient.company_name || '',
				phone: editClient.phone || '',
				email: editClient.email || '',
			})
		} else {
			setFormData({
				type: 'TOO',
				name: '',
				company_name: '',
				phone: '',
				email: '',
			})
		}

		setError('')
	}, [isOpen, editClient, isEditMode])

	if (!isOpen) return null

	const handleChange = e => {
		const { name, value } = e.target

		setFormData(prev => ({
			...prev,
			[name]: value,
		}))
	}

	const resetForm = () => {
		setFormData({
			type: 'TOO',
			name: '',
			company_name: '',
			phone: '',
			email: '',
		})
		setError('')
	}

	const handleClose = () => {
		resetForm()
		onClose()
	}

	const handleSubmit = async e => {
		e.preventDefault()
		setError('')

		if (!formData.name.trim()) {
			setError('ФИО представителя обязательно')
			return
		}

		if (!formData.phone.trim()) {
			setError('Телефон обязателен')
			return
		}

		setLoading(true)

		try {
			const token = localStorage.getItem('access_token')

			const payload = {
				type: formData.type,
				name: formData.name.trim(),
				company_name:
					formData.type === 'INDIVIDUAL'
						? null
						: formData.company_name.trim() || null,
				phone: formData.phone.trim(),
				email: formData.email.trim() || null,
			}

			const url = isEditMode
				? `http://127.0.0.1:8000/clients/${editClient.id}`
				: 'http://127.0.0.1:8000/clients'

			const method = isEditMode ? 'PATCH' : 'POST'

			const res = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				const errData = await res.json()
				throw new Error(errData.detail || 'Ошибка сохранения клиента')
			}

			resetForm()
			onCreated()
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className='modal-overlay open'>
			<div className='modal-window create-client-modal'>
				<div className='modal-header'>
					<span className='modal-title'>
						{isEditMode ? 'Редактировать клиента' : 'Добавить клиента'}
					</span>
					<button className='modal-close' onClick={handleClose} type='button'>
						&times;
					</button>
				</div>

				{error && <div className='create-client-error-banner'>{error}</div>}

				<div className='create-client-body'>
					<form id='create-client-form' onSubmit={handleSubmit}>
						<div className='create-client-card'>
							<div className='create-client-section-title'>
								Основная информация
							</div>

							<div className='create-client-grid'>
								<label className='create-client-field'>
									<span className='create-client-label required'>
										Тип клиента
									</span>
									<select
										name='type'
										value={formData.type}
										onChange={handleChange}
										className='create-client-input'
									>
										{Object.entries(CLIENT_TYPES).map(([key, label]) => (
											<option key={key} value={key}>
												{label}
											</option>
										))}
									</select>
								</label>

								<label className='create-client-field'>
									<span className='create-client-label required'>
										ФИО представителя
									</span>
									<input
										type='text'
										name='name'
										value={formData.name}
										onChange={handleChange}
										className='create-client-input'
										placeholder='Например: Иван Иванов'
									/>
								</label>

								{(formData.type === 'TOO' || formData.type === 'IP') && (
									<label className='create-client-field create-client-full'>
										<span className='create-client-label'>
											Название компании
										</span>
										<input
											type='text'
											name='company_name'
											value={formData.company_name}
											onChange={handleChange}
											className='create-client-input'
											placeholder='Например: TOO Autopark Monitoring'
										/>
									</label>
								)}
							</div>
						</div>

						<div className='create-client-card'>
							<div className='create-client-section-title'>Контакты</div>

							<div className='create-client-grid'>
								<label className='create-client-field'>
									<span className='create-client-label required'>Телефон</span>
									<input
										type='text'
										name='phone'
										value={formData.phone}
										onChange={handleChange}
										className='create-client-input'
										placeholder='+7 777 123 45 67'
									/>
								</label>

								<label className='create-client-field'>
									<span className='create-client-label'>Email</span>
									<input
										type='email'
										name='email'
										value={formData.email}
										onChange={handleChange}
										className='create-client-input'
										placeholder='client@example.com'
									/>
								</label>
							</div>
						</div>
					</form>
				</div>

				<div className='modal-footer create-client-footer'>
					<button
						className='create-client-cancel-btn'
						type='button'
						onClick={handleClose}
					>
						Отмена
					</button>

					<button
						className='create-client-submit-btn'
						type='submit'
						form='create-client-form'
						disabled={loading}
					>
						{loading
							? 'Сохранение...'
							: isEditMode
								? 'Сохранить изменения'
								: 'Сохранить клиента'}
					</button>
				</div>
			</div>
		</div>
	)
}
