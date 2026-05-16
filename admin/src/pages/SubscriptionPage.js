import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Typography, Row, Col, List, Tag, Space } from 'antd';
import { CheckCircleFilled, RocketOutlined, CrownOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const SubscriptionPage = () => {
  const navigate = useNavigate();

  const plans = [
    {
      id: 'starter',
      name: 'Plan Emprendedor',
      price: '29',
      icon: <RocketOutlined style={{ fontSize: '32px', color: '#1890ff' }} />,
      color: '#e6f7ff',
      features: ['Hasta 100 productos', 'Soporte vía Email', 'Panel de estadísticas básico', '1 Dominio personalizado'],
      buttonText: 'Empezar ahora',
      popular: false,
    },
    {
      id: 'pro',
      name: 'Plan Profesional',
      price: '99',
      icon: <CrownOutlined style={{ fontSize: '32px', color: '#722ed1' }} />,
      color: '#f9f0ff',
      features: ['Productos ilimitados', 'Soporte VIP 24/7', 'IA Product Analyzer full', 'Múltiples administradores', 'Reportes avanzados'],
      buttonText: 'Obtener Pro',
      popular: true,
    }
  ];

  const handleSelectPlan = (planId) => {
    navigate('/signup', { state: { planId } });
  };

  return (
    <div style={{ padding: '60px 20px', background: 'linear-gradient(180deg, #f0f2f5 0%, #ffffff 100%)', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center', marginBottom: '50px' }}>
        <Title level={1} style={{ marginBottom: '16px' }}>Impulsa tu negocio</Title>
        <Text type="secondary" style={{ fontSize: '18px' }}>
          Elige el plan que mejor se adapte al crecimiento de tu tienda online.
        </Text>
      </div>

      <Row gutter={[24, 24]} justify="center" style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {plans.map((plan) => (
          <Col xs={24} sm={12} key={plan.id}>
            <Card
              hoverable
              style={{
                borderRadius: '16px',
                border: plan.popular ? '2px solid #722ed1' : '1px solid #f0f0f0',
                position: 'relative',
                overflow: 'hidden',
                height: '100%',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {plan.popular && (
                <Tag color="#722ed1" style={{ position: 'absolute', top: 16, right: -30, transform: 'rotate(45deg)', width: '120px', textAlign: 'center' }}>
                  POPULAR
                </Tag>
              )}

              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ 
                  background: plan.color, 
                  width: '70px', 
                  height: '70px', 
                  borderRadius: '50%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  {plan.icon}
                </div>
                <Title level={3} style={{ marginBottom: 0 }}>{plan.name}</Title>
                <div style={{ margin: '16px 0' }}>
                  <Text style={{ fontSize: '40px', fontWeight: 'bold' }}>${plan.price}</Text>
                  <Text type="secondary"> / mes</Text>
                </div>
              </div>

              <List
                split={false}
                dataSource={plan.features}
                renderItem={(item) => (
                  <List.Item style={{ padding: '8px 0' }}>
                    <Space>
                      <CheckCircleFilled style={{ color: '#52c41a' }} />
                      <Text>{item}</Text>
                    </Space>
                  </List.Item>
                )}
                style={{ marginBottom: '32px', flexGrow: 1 }}
              />

              <Button
                type={plan.popular ? 'primary' : 'default'}
                size="large"
                block
                style={{ 
                  borderRadius: '8px', 
                  height: '50px', 
                  fontWeight: 'bold',
                  background: plan.popular ? '#722ed1' : '',
                  borderColor: plan.popular ? '#722ed1' : ''
                }}
                onClick={() => handleSelectPlan(plan.id)}
              >
                {plan.buttonText}
              </Button>
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ textAlign: 'center', marginTop: '40px' }}>
        <Text type="secondary">Todos los planes incluyen actualizaciones gratuitas y seguridad SSL.</Text>
      </div>
    </div>
  );
};

export default SubscriptionPage;