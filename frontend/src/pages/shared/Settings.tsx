import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/common/Layout';
import { ThemeToggle } from '../../components/settings/ThemeToggle';

export const Settings = () => {
  const navigate = useNavigate();

  return (
    <Layout title="Settings" showBack onBack={() => navigate(-1)}>
      <div className="space-y-6 max-w-2xl">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
            Appearance
          </h2>
          <ThemeToggle />
        </div>
      </div>
    </Layout>
  );
};

