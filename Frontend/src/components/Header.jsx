import React from 'react'
import logoImg from '../assets/logo.png'

export default function Header() {
	return (
		<header className='header'>
			<div className='logo'>
				<img src={logoImg} alt='AUTOPARK Monitoring' />
			</div>
			<div className='header-right'>
				<div className='search-wrap'>
					<input type='text' placeholder='Поиск' />
					<span className='search-icon'>
						<svg
							width='14'
							height='14'
							viewBox='0 0 24 24'
							fill='none'
							stroke='currentColor'
							strokeWidth='2.2'
							strokeLinecap='round'
							strokeLinejoin='round'
						>
							<circle cx='11' cy='11' r='8' />
							<line x1='21' y1='21' x2='16.65' y2='16.65' />
						</svg>
					</span>
				</div>
				<button className='user-btn'>
					<svg
						width='18'
						height='18'
						viewBox='0 0 24 24'
						fill='none'
						stroke='currentColor'
						strokeWidth='2'
						strokeLinecap='round'
						strokeLinejoin='round'
					>
						<path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
						<circle cx='12' cy='7' r='4' />
					</svg>
				</button>
			</div>
		</header>
	)
}
