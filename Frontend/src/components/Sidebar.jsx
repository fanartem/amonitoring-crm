import React from 'react'

// 1. Принимаем пропсы: activeSection (строка) и setActiveSection (функция)
export default function Sidebar({ activeSection, setActiveSection }) {
    
    // Вспомогательная функция, чтобы не дублировать логику проверки класса
    const getClassName = (sectionName) => {
        return `nav-item ${activeSection === sectionName ? 'active' : ''}`;
    };

    return (
        <nav className='sidebar'>
            <div className='sidebar-top'>
                {/* 2. По клику вызываем setActiveSection с именем нужного раздела */}
                <div 
                    className={getClassName('home')} 
                    onClick={() => setActiveSection('home')}
                >
                    Главная
                </div>
                
                <div 
                    className={getClassName('clients')} 
                    onClick={() => setActiveSection('clients')}
                >
                    Клиенты
                </div>
                
                <div 
                    className={getClassName('requests')} 
                    onClick={() => setActiveSection('requests')}
                >
                    Заявки
                </div>
                
                <div 
                    className={getClassName('employees')} 
                    onClick={() => setActiveSection('employees')}
                >
                    Сотрудники
                </div>
            </div>

            <div className='sidebar-bottom'>
                <div 
                    className={getClassName('settings')} 
                    onClick={() => setActiveSection('settings')}
                >
                    Настройки
                </div>
                <div className='nav-item' id='logout-btn'>
                    Выход
                </div>
            </div>
        </nav>
    )
}