import React, { useEffect, useState } from 'react'
import { API_BASE_URL } from '../api'

export default function Entrance() {
	const [isLoginMode, setIsLoginMode] = useState(true)

	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [name, setName] = useState('')
	const [role, setRole] = useState('')
	const [city, setCity] = useState('')
	const [cities, setCities] = useState([])

	const [error, setError] = useState('')
	const [success, setSuccess] = useState('')
	const [showPassword, setShowPassword] = useState(false)

	useEffect(() => {
		fetchCities()
	}, [])

	const fetchCities = async () => {
		try {
			const response = await fetch(`${API_BASE_URL}/cities`)

			if (response.ok) {
				const data = await response.json()
				setCities(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки городов:', err)
		}
	}

	// === ЛОГИКА ВХОДА ===
	const handleLogin = async e => {
		e.preventDefault()
		setError('')

		if (!email || !password) {
			setError('Введите email и пароль')
			return
		}

		try {
			const params = new URLSearchParams()
			params.append('username', email)
			params.append('password', password)

			const response = await fetch(`${API_BASE_URL}/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: params,
			})

			const data = await response.json()

			if (!response.ok) {
				throw new Error(data.detail || 'Неверный логин или пароль')
			}

			localStorage.setItem('access_token', data.access_token)
			localStorage.setItem('user_data', JSON.stringify(data.user))

			window.location.href = '/requests'
		} catch (err) {
			setError(err.message)
		}
	}

	// === ЛОГИКА РЕГИСТРАЦИИ ===
	const handleRegister = async e => {
		e.preventDefault()
		setError('')
		setSuccess('')

		if (!name || !email || !password || !role) {
			setError('Заполните все обязательные поля')
			return
		}

		if (role === 'TECHNICIAN' && !city) {
			setError('Для обычного монтажника необходимо обязательно указать город!')
			return
		}

		try {
			const response = await fetch(`${API_BASE_URL}/auth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					email,
					password,
					role,
					city: city || null,
				}),
			})

			const data = await response.json()

			if (!response.ok) {
				throw new Error(data.detail || 'Ошибка регистрации')
			}

			setSuccess('Заявка отправлена! Ожидайте одобрения администратора.')
			setName('')
			setEmail('')
			setPassword('')
			setRole('')
			setCity('')
		} catch (err) {
			setError(err.message)
		}
	}

	const toggleMode = () => {
		setIsLoginMode(!isLoginMode)
		setError('')
		setSuccess('')
	}

	return (
		<div className='login-screen'>
			{isLoginMode ? (
				<form className='login-card' onSubmit={handleLogin}>
					<div className='login-logo'>
						<img
							src='/logo.png'
							alt='Amonitoring'
							onError={e => (e.target.style.display = 'none')}
						/>
						<h1 className='login-brand'>
							Amonitoring <span>CRM</span>
						</h1>
					</div>
					<h2 className='login-title'>Вход в систему</h2>

					{error && <div className='login-error visible'>{error}</div>}

					<div className='login-field'>
						<label className='login-label'>Логин (email)</label>
						<input
							className='login-input'
							type='email'
							value={email}
							onChange={e => setEmail(e.target.value)}
							placeholder='Введите email'
						/>
					</div>

					<div className='login-field'>
						<label className='login-label'>Пароль</label>
						<div className='pw-wrap'>
							<input
								className='login-input'
								type={showPassword ? 'text' : 'password'}
								value={password}
								onChange={e => setPassword(e.target.value)}
								placeholder='Введите пароль'
							/>
							<button
								type='button'
								className='pw-toggle'
								onClick={() => setShowPassword(!showPassword)}
							>
								<svg
									className='eye-icon'
									width='16'
									height='16'
									viewBox='0 0 24 24'
									fill='none'
									stroke='currentColor'
									strokeWidth='2'
									strokeLinecap='round'
									strokeLinejoin='round'
								>
									<path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
									<circle cx='12' cy='12' r='3' />
								</svg>
							</button>
						</div>
					</div>

					<button type='submit' className='login-btn'>
						Войти
					</button>

					<p
						className='login-hint'
						style={{ textAlign: 'center', marginTop: '4px' }}
					>
						Нет аккаунта?{' '}
						<button type='button' className='link-btn' onClick={toggleMode}>
							Зарегистрироваться
						</button>
					</p>
				</form>
			) : (
				<form
					className='login-card'
					style={{ maxWidth: '420px' }}
					onSubmit={handleRegister}
				>
					<div className='login-logo'>
						<img
							src='/logo.png'
							alt='Amonitoring'
							onError={e => (e.target.style.display = 'none')}
						/>
						<h1 className='login-brand'>
							Amonitoring <span>CRM</span>
						</h1>
					</div>
					<h2 className='login-title'>Регистрация</h2>

					{error && <div className='login-error visible'>{error}</div>}
					{success && <div className='login-success visible'>{success}</div>}

					<div className='login-field'>
						<label className='login-label'>
							ФИО <span style={{ color: '#e53e3e' }}>*</span>
						</label>
						<input
							className='login-input'
							type='text'
							value={name}
							onChange={e => setName(e.target.value)}
							placeholder='Полное имя'
						/>
					</div>

					<div className='login-field'>
						<label className='login-label'>
							Почта (email) <span style={{ color: '#e53e3e' }}>*</span>
						</label>
						<input
							className='login-input'
							type='email'
							value={email}
							onChange={e => setEmail(e.target.value)}
							placeholder='example@mail.ru'
						/>
					</div>

					<div className='login-field'>
						<label className='login-label'>
							Пароль <span style={{ color: '#e53e3e' }}>*</span>
						</label>
						<div className='pw-wrap'>
							<input
								className='login-input'
								type={showPassword ? 'text' : 'password'}
								value={password}
								onChange={e => setPassword(e.target.value)}
								placeholder='Придумайте пароль'
							/>
							<button
								type='button'
								className='pw-toggle'
								onClick={() => setShowPassword(!showPassword)}
							>
								<svg
									className='eye-icon'
									width='16'
									height='16'
									viewBox='0 0 24 24'
									fill='none'
									stroke='currentColor'
									strokeWidth='2'
									strokeLinecap='round'
									strokeLinejoin='round'
								>
									<path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
									<circle cx='12' cy='12' r='3' />
								</svg>
							</button>
						</div>
					</div>

					<div className='login-field'>
						<label className='login-label'>
							Город{' '}
							{role === 'TECHNICIAN' && (
								<span style={{ color: '#e53e3e' }}>*</span>
							)}
						</label>
						<select
							className='login-input'
							style={{ cursor: 'pointer' }}
							value={city}
							onChange={e => setCity(e.target.value)}
						>
							<option value=''>— выберите город —</option>

							{cities.map(cityItem => (
								<option key={cityItem.id} value={cityItem.name}>
									{cityItem.name}
								</option>
							))}
						</select>
					</div>

					<div className='login-field'>
						<label className='login-label'>
							Роль <span style={{ color: '#e53e3e' }}>*</span>
						</label>
						<select
							className='login-input'
							style={{ cursor: 'pointer' }}
							value={role}
							onChange={e => {
								const nextRole = e.target.value
								setRole(nextRole)

								if (nextRole !== 'TECHNICIAN') {
									setCity('')
								}
							}}
						>
							<option value=''>— выберите роль —</option>
							<option value='MANAGER'>Менеджер</option>
							<option value='ROP'>РОП</option>
							<option value='TECH_SUPPORT'>Тех. поддержка</option>
							<option value='ACCOUNTANT'>Бухгалтер</option>
							<option value='SENIOR_TECHNICIAN'>Старший монтажник</option>
							<option value='TECHNICIAN'>Монтажник</option>
							<option value='WAREHOUSE_MANAGER'>Заведующий складом</option>
						</select>
					</div>

					<button type='submit' className='login-btn'>
						Зарегистрироваться
					</button>

					<p className='login-hint' style={{ textAlign: 'center' }}>
						Уже есть аккаунт?{' '}
						<button type='button' className='link-btn' onClick={toggleMode}>
							Войти
						</button>
					</p>
				</form>
			)}
		</div>
	)
}
