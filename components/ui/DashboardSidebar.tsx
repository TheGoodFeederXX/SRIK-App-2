import React, { cloneElement } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { HomeIcon, BellIcon, UserIcon as ProfileIcon, DocumentTextIcon, PhoneIcon, PlayIcon, AnalyticsIcon, MegaphoneIcon, SettingsIcon, MessagesIcon, ElearningIcon, SparklesIcon, UserGroupIcon, GameControllerIcon, ChartBarIcon, ClockIcon, LogoutIcon, ReportIcon, CheckCircleIcon, BuildingLibraryIcon, StudentsIcon, ClipboardListIcon, ExamIcon, EnterResultsIcon, ShieldCheckIcon, SUBJECT_COLORS, getFormattedClassName } from '../../constants';
import { useTeacherClasses } from '../../hooks/useTeacherClasses';
import { SCHOOL_NAME } from '../../src/lib/branding';

// ⚠️ PERMANENT, OWNER-LOCKED NAV SETS ⚠️
// The item list (count, labels, order) in EVERY *Sidebar component below —
// Admin, Teacher, Parent, Student (and any other role added later) — is fixed
// by explicit owner instruction, same as components/ui/DashboardBottomNav.tsx.
// Do NOT add, remove, or reorder any item in any of these sidebars for any
// reason without first stopping and getting explicit confirmation from the
// owner. New feature entry points belong on that role's Quick Actions/
// home-screen tiles instead — never here.
//
// Exception on record: AdminSidebar's Students/Timetable/Exams/Results/
// Compliance items (Phase 6.2, owner-approved) promote daily-use screens out
// of the Quick Actions grid. Any further change to AdminSidebar still needs
// the same explicit sign-off as every other sidebar here.

interface SidebarItemProps {
    icon: React.ReactElement<{ className?: string }>;
    label: string;
    isActive: boolean;
    onClick: () => void;
    activeColor: string;
}

const SidebarItem = ({ icon, label, isActive, onClick, activeColor }: SidebarItemProps & { id?: string }) => (
    <motion.button
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className={`w-full flex items-center space-x-3 px-6 py-4 transition-colors duration-200 ${isActive ? `bg-gray-50 border-r-4 ${activeColor} border-current` : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
    >
        {cloneElement(icon, { className: `h-6 w-6 ${isActive ? activeColor : ''}` })}
        <span className={`font-medium ${isActive ? 'text-gray-900' : ''}`}>{label}</span>
    </motion.button>
);

export const StudentSidebar = ({ activeScreen, setActiveScreen, onLogout, schoolName, logoUrl }: { activeScreen: string, setActiveScreen: (screen: string) => void, onLogout?: () => void, schoolName?: string, logoUrl?: string }) => {
    const { t } = useTranslation();
    const navItems = [
        { id: 'home', icon: <HomeIcon />, label: t('dashboardBottomNav.home') },
        { id: 'quizzes', icon: <ClockIcon />, label: t('dashboardSidebar.quizzes') },
        { id: 'games', icon: <GameControllerIcon />, label: t('dashboardBottomNav.games') },
        { id: 'messages', icon: <MessagesIcon />, label: t('dashboardSidebar.messages') },
        { id: 'profile', icon: <ProfileIcon />, label: t('dashboardSidebar.profile') },
    ];

    return (
        <div className="h-full flex flex-col bg-white border-r border-gray-200">
            <div className="p-6 flex items-center space-x-3 border-b border-gray-100">
                {logoUrl ? (
                    <img src={logoUrl} alt={t('dashboardSidebar.logo')} className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                    <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-lg">{schoolName ? schoolName.charAt(0) : 'S'}</span>
                    </div>
                )}
                <span className="text-xl font-bold text-gray-800 truncate" title={schoolName}>{schoolName || SCHOOL_NAME}</span>
            </div>

            <nav className="flex-1 py-6 overflow-y-auto">
                <div className="space-y-1">
                    {navItems.map(item => (
                        <SidebarItem
                            key={item.id}
                            icon={item.icon}
                            label={item.label}
                            isActive={activeScreen === item.id}
                            onClick={() => setActiveScreen(item.id)}
                            activeColor="text-orange-500"
                        />
                    ))}
                </div>
            </nav>

            {onLogout && (
                <div className="p-4 border-t border-gray-100">
                    <motion.button
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onLogout}
                        className="w-full flex items-center space-x-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                        <LogoutIcon className="h-6 w-6" />
                        <span className="font-medium">{t('common.logout')}</span>
                    </motion.button>
                </div>
            )}
        </div>
    );
};

export const AdminSidebar = ({ activeScreen, setActiveScreen, onLogout, schoolName, logoUrl }: { activeScreen: string, setActiveScreen: (screen: string) => void, onLogout?: () => void, schoolName?: string, logoUrl?: string }) => {
    const { t } = useTranslation();
    // navItems definition removed in favor of explicit groups below

    return (
        <div className="h-full flex flex-col bg-white border-r border-gray-200">
            <div className="p-6 flex items-center space-x-3 border-b border-gray-100">
                {logoUrl ? (
                    <img src={logoUrl} alt={t('dashboardSidebar.logo')} className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-lg">{schoolName ? schoolName.charAt(0) : 'A'}</span>
                    </div>
                )}
                <span className="text-lg font-bold text-gray-800 truncate" title={schoolName}>{schoolName || SCHOOL_NAME}</span>
            </div>

            <nav className="flex-1 py-6 overflow-y-auto">
                <div className="space-y-1">
                    <SidebarItem id="home" icon={<HomeIcon />} label={t('dashboardSidebar.home')} isActive={activeScreen === 'home'} onClick={() => setActiveScreen('home')} activeColor="text-indigo-600" />
                    <SidebarItem id="studentList" icon={<StudentsIcon />} label={t('dashboardSidebar.students')} isActive={activeScreen === 'studentList'} onClick={() => setActiveScreen('studentList')} activeColor="text-indigo-600" />
                    <SidebarItem id="teacherList" icon={<UserGroupIcon />} label={t('dashboardSidebar.teachers')} isActive={activeScreen === 'teacherList'} onClick={() => setActiveScreen('teacherList')} activeColor="text-indigo-600" />
                    <SidebarItem id="timetable" icon={<ClipboardListIcon />} label={t('dashboardSidebar.timetable')} isActive={activeScreen === 'timetable'} onClick={() => setActiveScreen('timetable')} activeColor="text-indigo-600" />
                    <SidebarItem id="examManagement" icon={<ExamIcon />} label={t('dashboardSidebar.exams')} isActive={activeScreen === 'examManagement'} onClick={() => setActiveScreen('examManagement')} activeColor="text-indigo-600" />
                    <SidebarItem id="results" icon={<EnterResultsIcon />} label={t('dashboardSidebar.results')} isActive={activeScreen === 'results'} onClick={() => setActiveScreen('results')} activeColor="text-indigo-600" />
                    <SidebarItem id="compliance" icon={<ShieldCheckIcon />} label={t('dashboardSidebar.compliance')} isActive={activeScreen === 'compliance'} onClick={() => setActiveScreen('compliance')} activeColor="text-indigo-600" />
                    <SidebarItem id="studentApprovals" icon={<CheckCircleIcon />} label={t('dashboardSidebar.approvals')} isActive={activeScreen === 'studentApprovals'} onClick={() => setActiveScreen('studentApprovals')} activeColor="text-indigo-600" />
                    <SidebarItem id="feeManagement" icon={<DocumentTextIcon />} label={t('dashboardSidebar.feeManagement')} isActive={activeScreen === 'feeManagement'} onClick={() => setActiveScreen('feeManagement')} activeColor="text-indigo-600" />
                    <SidebarItem id="messages" icon={<MessagesIcon />} label={t('dashboardSidebar.messages')} isActive={activeScreen === 'messages'} onClick={() => setActiveScreen('messages')} activeColor="text-indigo-600" />
                    <SidebarItem id="analytics" icon={<AnalyticsIcon />} label={t('dashboardSidebar.analytics')} isActive={activeScreen === 'analytics'} onClick={() => setActiveScreen('analytics')} activeColor="text-indigo-600" />
                    <SidebarItem id="settings" icon={<SettingsIcon />} label={t('dashboardSidebar.settings')} isActive={activeScreen === 'settings'} onClick={() => setActiveScreen('settings')} activeColor="text-indigo-600" />
                </div>
            </nav>

            {onLogout && (
                <div className="p-4 border-t border-gray-100">
                    <motion.button
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onLogout}
                        className="w-full flex items-center space-x-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                        <LogoutIcon className="h-6 w-6" />
                        <span className="font-medium">{t('common.logout')}</span>
                    </motion.button>
                </div>
            )}
        </div>
    );
};

export const TeacherSidebar = ({ activeScreen, setActiveScreen, onLogout, schoolName, logoUrl }: { activeScreen: string, setActiveScreen: (screen: string) => void, onLogout?: () => void, schoolName?: string, logoUrl?: string }) => {
    const { t } = useTranslation();
    const { classes: teacherClasses } = useTeacherClasses();
    const navItems = [
        { id: 'home', icon: <HomeIcon />, label: t('dashboardBottomNav.home') },
        { id: 'lessonNotes', icon: <DocumentTextIcon />, label: t('dashboardSidebar.lessonNotes') },
        { id: 'reports', icon: <ReportIcon />, label: t('dashboardSidebar.reports') },
        { id: 'forum', icon: <UserGroupIcon />, label: t('dashboardBottomNav.forum') },
        { id: 'messages', icon: <MessagesIcon />, label: t('dashboardSidebar.messages') },
        { id: 'settings', icon: <SettingsIcon />, label: t('dashboardSidebar.settings') },
    ];

    return (
        <div className="h-full flex flex-col bg-white border-r border-gray-200">
            <div className="p-6 flex items-center space-x-3 border-b border-gray-100">
                {logoUrl ? (
                    <img src={logoUrl} alt={t('dashboardSidebar.logo')} className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                    <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-lg">{schoolName ? schoolName.charAt(0) : 'T'}</span>
                    </div>
                )}
                <span className="text-xl font-bold text-gray-800 truncate" title={schoolName}>{schoolName || SCHOOL_NAME}</span>
            </div>

            <nav className="flex-1 py-6 overflow-y-auto">
                <div className="space-y-1">
                    {navItems.map(item => (
                        <SidebarItem
                            key={item.id}
                            icon={item.icon}
                            label={item.label}
                            isActive={activeScreen === item.id}
                            onClick={() => setActiveScreen(item.id)}
                            activeColor="text-purple-600"
                        />
                    ))}
                </div>
            </nav>

            {onLogout && (
                <div className="p-4 border-t border-gray-100">
                    <motion.button
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onLogout}
                        className="w-full flex items-center space-x-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                        <LogoutIcon className="h-6 w-6" />
                        <span className="font-medium">{t('common.logout')}</span>
                    </motion.button>
                </div>
            )}
        </div>
    );
};

export const ParentSidebar = ({ activeScreen, setActiveScreen, onLogout, schoolName, logoUrl }: { activeScreen: string, setActiveScreen: (screen: string) => void, onLogout?: () => void, schoolName?: string, logoUrl?: string }) => {
    const { t } = useTranslation();
    const navItems = [
        { id: 'home', icon: <HomeIcon />, label: t('dashboardBottomNav.home') },
        { id: 'fees', icon: <DocumentTextIcon />, label: t('dashboardSidebar.feeStatus') },
        { id: 'reports', icon: <ReportIcon />, label: t('dashboardSidebar.reports') },
        { id: 'messages', icon: <MessagesIcon />, label: t('dashboardSidebar.messages') },
        { id: 'more', icon: <SettingsIcon />, label: t('dashboardBottomNav.more') },
    ];

    return (
        <div className="h-full flex flex-col bg-white border-r border-gray-200">
            <div className="p-6 flex items-center space-x-3 border-b border-gray-100">
                {logoUrl ? (
                    <img src={logoUrl} alt={t('dashboardSidebar.logo')} className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                    <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-lg">{schoolName ? schoolName.charAt(0) : 'P'}</span>
                    </div>
                )}
                <span className="text-xl font-bold text-gray-800 truncate" title={schoolName}>{schoolName || SCHOOL_NAME}</span>
            </div>

            <nav className="flex-1 py-6 overflow-y-auto">
                <div className="space-y-1">
                    {navItems.map(item => (
                        <SidebarItem
                            key={item.id}
                            icon={item.icon}
                            label={item.label}
                            isActive={activeScreen === item.id}
                            onClick={() => setActiveScreen(item.id)}
                            activeColor="text-green-600"
                        />
                    ))}
                </div>
            </nav>

            {onLogout && (
                <div className="p-4 border-t border-gray-100">
                    <motion.button
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onLogout}
                        className="w-full flex items-center space-x-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                        <LogoutIcon className="h-6 w-6" />
                        <span className="font-medium">{t('common.logout')}</span>
                    </motion.button>
                </div>
            )}
        </div>
    );
};

