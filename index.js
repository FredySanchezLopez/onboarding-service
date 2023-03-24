const express = require('express');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const port = 3000;
const jwtSecret = process.env.JWT_SECRET;

//Middleware para Parsear el JSON del cuerpo de las solicitudes HTTP
app.use(express.json());

//Endpoint de registro de clientes
app.post('/signup', async (req, res) => {
  const schema = Joi.object({
    email: Joi.string().required(),
    phoneNumber: Joi.string().length(10).pattern(/^[0-9]+$/).required(),
    password: Joi.string().min(8).required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).send({ error: error.details[0].message });
  }

  //Verificar que el correo o el telefono no existen
  const customerExistsByEmail = await axios.get('http://tchdev.techreo.mx:2020/LabService/customer', {
    headers: { Authorization: `Bearer ${req.headers.authorization}` },
    params: { email: value.email }
  }).then(response => response.data.length > 0);
  if (customerExistsByEmail) {
    return res.status(400).send({ error: 'El correo ya está registrado' });
  }
  const customerExistsByPhoneNumber = await axios.get('http://tchdev.techreo.mx:2020/LabService/customer', {
    headers: { Authorization: `Bearer ${req.headers.authorization}` },
    params: { phoneNumber: value.phoneNumber }
  }).then(response => response.data.length > 0);
  if (customerExistsByPhoneNumber) {
    return res.status(400).send({ error: 'El teléfono ya está registrado' });
  }

  // Registrar al cliente en la base de datos
  const customer = await axios.post('http://tchdev.techreo.mx:2020/LabService/customer', {
    email: value.email,
    phoneNumber: value.phoneNumber,
    password: value.password
  }, {
    headers: { Authorization: `Bearer ${req.headers.authorization}` }
  }).then(response => response.data);

  res.send({ customerId: customer.id });
});

// Endpoint para los datos generales del cliente
app.post('/customer/general', async (req, res) => {
  try {
    const { nombres, apellidoPaterno, apellidoMaterno, curp, rfc } = req.body;
    // Verificar que la CURP y el RFC no existan en la base de datos
    const existingCustomer = await Customer.findOne({
      $or: [{ curp }, { rfc }]
    });
    if (existingCustomer) {
      return res.status(400).json({ message: 'La CURP o RFC ya está registrado' });
    }

    // Obtener el cliente creado en el paso anterior
    const { customerId } = req.user;
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(400).json({ message: 'El cliente no ha sido creado' });
    }

    // Actualizar los datos generales del cliente
    customer.nombres = nombres;
    customer.apellidoPaterno = apellidoPaterno;
    customer.apellidoMaterno = apellidoMaterno;
    customer.curp = curp;
    customer.rfc = rfc;
    await customer.save();

    return res.json({ message: 'Datos generales del cliente actualizados correctamente' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error al actualizar los datos generales del cliente' });
  }
});

// Endpoint para la firma de documentos
app.post('/customer/sign-documents', async (req, res) => {
  try {
    // Generar un token que simule la firma digital del cliente
    const token = jwt.sign({}, jwtSecret);
    // Envío de una url de los contratos (puede ser una url falsa)
    const contractUrl = 'https://example.com/contratos';

    // Crear una cuenta de ahorro y cuenta clabe
    const { customerId } = req.user;
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(400).json({ message: 'El cliente no ha sido creado' });
    }

    // Crear la cuenta de ahorro
    const accountNumber = generateAccountNumber();
    const savingsAccount = new SavingsAccount({
      accountNumber,
      balance: 0,
      customerId: customer._id
    });
    await savingsAccount.save();

    // Crear la cuenta clabe
    const clabe = generateClabe();
    const bankAccount = new BankAccount({
      clabe,
      customerId: customer._id
    });
    await bankAccount.save();

    // Asociar la cuenta clabe a la cuenta de ahorro
    savingsAccount.bankAccountId = bankAccount._id;
    await savingsAccount.save();

    return res.json({
      message: 'Cuenta de ahorro y cuenta clabe creadas correctamente',
      token,
      contractUrl
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error al firmar los documentos' });
  }
});

// Endpoint para la consulta de saldo
app.get('/savings-account/balance', authenticateToken, async (req, res) => {
  try {
    const { customerId } = req.user;
    // Buscar la cuenta de ahorro asociada al cliente
    const savingsAccount = await SavingsAccount.findOne({
      customerId
    }).populate('bankAccountId');
    if (!savingsAccount) {
      return res.status(400).json({ message: 'No se encontró la cuenta de ahorro del cliente' });
    }

    return res.json({
      balance: savingsAccount.balance
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error al obtener el saldo de la cuenta de ahorro' });
  }
});

// Endpoint para obtener el saldo de la cuenta de ahorro
app.get('/balance/:accountNumber', authenticateToken, async (req, res) => {
  const accountNumber = req.params.accountNumber;
  const balance = await getAccountBalance(accountNumber);

  if (balance === null) {
    return res.status(404).json({ error: 'Account not found' });
  }

  res.json({ balance });
});

// Función para obtener el saldo de la cuenta de ahorro
async function getAccountBalance(accountNumber) {
  try {
    const response = await axios.get(`${bankBaseUrl}/accounts/${accountNumber}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const balance = response.data.balance;
    return balance;
  } catch (error) {
    console.error(error);
    return null;
  }
}