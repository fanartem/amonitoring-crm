import React, { useState } from 'react'
import { API_BASE_URL, getJsonAuthHeaders } from '../../api'
import {
	canChangeOwnPortalPassword,
	getStoredUser,
	getUserClientName,
} from '../../utils/access'

const EMPTY_FORM = {
	current_password: '',
	new_password: '',
	repeat_password: '',
}

const MIN_PASSWORD_LENGTH = 8

export default function PortalProfile() {
	const currentUser = getStoredUser()

	const [form, setForm] = useState(EMPTY_FORM)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [success, setSuccess] = useState('')

	const canChangePassword = canChangeOwnPortalPassword(currentUser)
	const clientName = getUserClientName(currentUser)

	const updateField = (field, value) => {
		setForm(prev => ({ ...prev, [field]: value }))
		setError('')
		setSuccess('')
	}

	const handleSubmit = async e => {
		e.preventDefault()

		if (!canChangePassword) return

		// Совпадение проверяем здесь: на сервер второе поле не уходит,
		// это чисто защита от опечатки в форме.
		if (form.new_password !== form.repeat_password) {
			setError('Новый пароль и повтор не совпадают')
			return
		}

		if (form.new_password.length < MIN_PASSWORD_LENGTH) {
			setError(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
			return
		}

		setLoading(true)
		setError('')
		setSuccess('')

		try {
			const res = await fetch(`${API_BASE_URL}/auth/password/change`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					current_password: form.current_password,
					new_password: form.new_password,
				}),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось изменить пароль')
			}

			setForm(EMPTY_FORM)
			setSuccess(
				'Пароль изменён. Сейчас потребуется войти заново — так закрываются все сеансы, начатые со старым паролем.',
			)

			// Токен этой вкладки погашен вместе с остальными. Перезагрузка
			// отправит App.jsx в /auth/me, тот получит 401 и вернёт
			// пользователя на экран входа. Отдельного разлогина не пишем,
			// чтобы не дублировать логику очистки из App.jsx.
			setTimeout(() => window.location.reload(), 2500)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className='portal-page'>
			<style>{`
				.portal-page {
					padding: 24px 20px 40px;
					max-width: 640px;
				}

				.portal-page h2 {
					margin: 0 0 18px;
					font-size: 20px;
					color: #222;
				}

				.portal-card {
					background: #fff;
					border: 1px solid #e6e6e6;
					border-radius: 10px;
					padding: 18px;
					margin-bottom: 18px;
				}

				.portal-card-title {
					font-size: 15px;
					font-weight: 700;
					color: #222;
					margin-bottom: 12px;
				}

				.portal-info-row {
					display: flex;
					justify-content: space-between;
					gap: 16px;
					padding: 8px 0;
					border-bottom: 1px solid #f2f2f2;
					font-size: 14px;
				}

				.portal-info-row:last-child {
					border-bottom: none;
				}

				.portal-info-key {
					color: #777;
				}

				.portal-info-val {
					color: #222;
					font-weight: 600;
					text-align: right;
					word-break: break-all;
				}

				.portal-field {
					display: flex;
					flex-direction: column;
					gap: 4px;
					margin-bottom: 14px;
				}

				.portal-field label {
					font-size: 12px;
					font-weight: 600;
					color: #555;
				}

				.portal-input {
					border: 1px solid #ddd;
					border-radius: 6px;
					padding: 9px 11px;
					font-size: 14px;
					width: 100%;
					box-sizing: border-box;
				}

				.portal-hint {
					font-size: 12px;
					color: #888;
					line-height: 1.45;
				}

				.portal-banner {
					padding: 10px 12px;
					border-radius: 8px;
					font-size: 13px;
					line-height: 1.45;
					margin-bottom: 14px;
				}

				.portal-banner.error {
					background: #fdecea;
					border: 1px solid #f5c6cb;
					color: #b71c1c;
				}

				.portal-banner.success {
					background: #edf7e6;
					border: 1px solid #cfe6b8;
					color: #3f6b1a;
				}

				.portal-banner.info {
					background: #f4f6f8;
					border: 1px solid #e0e4e8;
					color: #555;
				}

				.portal-submit-btn {
					background: #5e9424;
					color: #fff;
					border: none;
					border-radius: 6px;
					padding: 10px 18px;
					font-size: 14px;
					font-weight: 600;
					cursor: pointer;
				}

				.portal-submit-btn:disabled {
					opacity: 0.6;
					cursor: not-allowed;
				}
			`}</style>

			<h2>Профиль</h2>

			<div className='portal-card'>
				<div className='portal-card-title'>Учётная запись</div>

				{clientName && (
					<div className='portal-info-row'>
						<span className='portal-info-key'>Организация</span>
						<span className='portal-info-val'>{clientName}</span>
					</div>
				)}

				<div className='portal-info-row'>
					<span className='portal-info-key'>Имя</span>
					<span className='portal-info-val'>{currentUser?.name || '—'}</span>
				</div>

				<div className='portal-info-row'>
					<span className='portal-info-key'>Логин</span>
					<span className='portal-info-val'>{currentUser?.email || '—'}</span>
				</div>
			</div>

			<div className='portal-card'>
				<div className='portal-card-title'>Смена пароля</div>

				{error && <div className='portal-banner error'>{error}</div>}
				{success && <div className='portal-banner success'>{success}</div>}

				{!canChangePassword ? (
					<div className='portal-banner info'>
						Смена пароля недоступна. Обратитесь к вашему менеджеру.
					</div>
				) : (
					<form onSubmit={handleSubmit}>
						<div className='portal-field'>
							<label>Текущий пароль</label>
							<input
								className='portal-input'
								type='password'
								autoComplete='current-password'
								value={form.current_password}
								onChange={e => updateField('current_password', e.target.value)}
								required
							/>
						</div>

						<div className='portal-field'>
							<label>Новый пароль</label>
							<input
								className='portal-input'
								type='password'
								autoComplete='new-password'
								minLength={MIN_PASSWORD_LENGTH}
								value={form.new_password}
								onChange={e => updateField('new_password', e.target.value)}
								required
							/>
							<span className='portal-hint'>
								Минимум {MIN_PASSWORD_LENGTH} символов. Забытый пароль
								восстановить нельзя — новый выдаёт ваш менеджер.
							</span>
						</div>

						<div className='portal-field'>
							<label>Повторите новый пароль</label>
							<input
								className='portal-input'
								type='password'
								autoComplete='new-password'
								minLength={MIN_PASSWORD_LENGTH}
								value={form.repeat_password}
								onChange={e => updateField('repeat_password', e.target.value)}
								required
							/>
						</div>

						<button
							type='submit'
							className='portal-submit-btn'
							disabled={loading}
						>
							{loading ? 'Сохранение...' : 'Изменить пароль'}
						</button>
					</form>
				)}
			</div>
		</div>
	)
}
