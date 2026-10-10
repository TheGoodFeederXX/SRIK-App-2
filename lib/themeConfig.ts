import { DashboardType } from '../types';

// Split out of constants.tsx so Login (a static, always-eager import — see
// App.tsx's comment on why) can pull in THEME_CONFIG without also dragging in
// the ~100 other icon components constants.tsx exports for lazy-loaded
// dashboards. constants.tsx re-exports this for every other existing caller.
export const THEME_CONFIG = {
  [DashboardType.Admin]: {
    mainBg: 'bg-gradient-to-br from-indigo-700 to-indigo-900',
    activeNav: 'bg-indigo-100 text-indigo-800',
    inactiveNav: 'text-gray-500 hover:text-gray-700',
    cardBg: 'bg-white',
    textColor: 'text-gray-800',
    iconColor: 'text-indigo-700',
    chartColor: '#312e81',
    cardIconBg: 'bg-indigo-100',
  },
  [DashboardType.Teacher]: {
    mainBg: 'bg-purple-700',
    activeNav: 'bg-purple-100 text-purple-700',
    inactiveNav: 'text-gray-500 hover:text-gray-700',
    cardBg: 'bg-white',
    textColor: 'text-gray-800',
    iconColor: 'text-purple-600',
    chartColor: '#7c3aed',
    cardIconBg: 'bg-purple-100',
  },
  [DashboardType.Parent]: {
    mainBg: 'bg-green-600',
    activeNav: 'bg-green-100 text-green-700',
    inactiveNav: 'text-gray-500 hover:text-gray-700',
    cardBg: 'bg-white',
    textColor: 'text-gray-800',
    iconColor: 'text-green-600',
    chartColor: '#16a34a',
    cardIconBg: 'bg-green-100',
  },
  [DashboardType.Student]: {
    mainBg: 'bg-orange-500',
    activeNav: 'bg-orange-100 text-orange-700',
    inactiveNav: 'text-gray-500 hover:text-gray-700',
    cardBg: 'bg-white',
    textColor: 'text-gray-800',
    iconColor: 'text-orange-600',
    chartColor: '#ea580c',
    cardIconBg: 'bg-orange-100',
  },
};
