import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRightIcon } from '../../constants';
import { useAuth } from '../../context/AuthContext';
import { updateSchoolSettings } from '../../src/lib/supabase/schoolProfile';
import { toast } from 'react-hot-toast';

const Accordion: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex justify-between items-center p-4 text-left font-bold text-gray-800">
        <span>{title}</span>
        <ChevronRightIcon className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 border-t overflow-hidden">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const FinancialSettingsScreen: React.FC = () => {
    const { t } = useTranslation();
  const { currentSchool } = useAuth();
  const [currency, setCurrency] = useState('MYR');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (currentSchool?.settings?.financial) {
      setCurrency(currentSchool.settings.financial.currency || 'MYR');
    }
  }, [currentSchool]);

  const handleSave = async () => {
    if (!currentSchool?.id) return;
    setIsLoading(true);
    try {
      // Merged in the database, so this screen cannot revert a setting changed on
      // another screen while it was open. It used to write the whole object back.
      await updateSchoolSettings({ financial: { currency } });

      toast.success(t('financialSettingsScreen.financialSettingsSaved'));
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4 bg-gray-50">
      <Accordion title={t('financialSettingsScreen.tuitionFeeStructure')} defaultOpen>
        <div className="flex items-center justify-between p-2">
          <label className="text-sm font-medium">{t('financialSettingsScreen.defaultCurrency')}</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="border rounded-md p-1">
            <option value="MYR">{t('financialSettingsScreen.ringgitMalaysiaRM')}</option>
            <option value="USD">{t('financialSettingsScreen.usd')}</option>
            <option value="GBP">{t('financialSettingsScreen.gbp')}</option>
          </select>
        </div>
      </Accordion>
      <Accordion title={t('financialSettingsScreen.invoicePaymentMethods')}>
        <p className="text-gray-600 text-sm">Customize invoice templates and enable payment methods like Bank Transfer, Card, etc.</p>
      </Accordion>
      <motion.button
        whileHover={!isLoading ? { scale: 1.01 } : {}} whileTap={!isLoading ? { scale: 0.98 } : {}}
        onClick={handleSave}
        disabled={isLoading}
        className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-indigo-700 transition disabled:opacity-50"
      >
        {isLoading ? t('financialSettingsScreen.saving') : t('financialSettingsScreen.saveFinancialSettings')}
      </motion.button>
    </div>
  );
};
export default FinancialSettingsScreen;
