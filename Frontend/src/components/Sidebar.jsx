import React from 'react'

export default function Sidebar() {
	// В будущем здесь будет логика переключения активного класса
	return (
		<nav className='sidebar'>
			<div className='sidebar-top'>
				{/* Добавляем className="active" для теста */}
				<div className='nav-item active'>Главная</div>
				<div className='nav-item'>Клиенты</div>
				<div className='nav-item'>Заявки</div>
				<div className='nav-item'>Сотрудники</div>
			</div>
			<div className='sidebar-bottom'>
				<div className='nav-item'>Настройки</div>
				<div className='nav-item' id='logout-btn'>
					Выход
				</div>
			</div>
		</nav>
	)
}
