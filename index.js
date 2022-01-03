const dotenv = require('dotenv');
dotenv.config();

const express=require("express");
const app = express();

const cors = require("cors");

const {MongoClient} = require("mongodb");
const MONGO_URL = process.env.MONGO_URL;

const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const shortId = require("shortid");

const PORT = process.env.PORT||5000;


app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:false}))

//creating mongodb connection
async function createConnection() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  return client;
}

//total urls data
app.get('/urlsData', async(req,res)=>{
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").aggregate([{
    "$sort": {
      "createdAt": -1
    }
  }]).toArray();
  res.send(urlsData);
})

//converting full URL to short URL
app.post('/shortUrl', async (req,res)=>{
  const {fullUrl} = req.body;
  const short = shortId.generate();
  const date = new Date().toISOString().slice(0,10);
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").insertOne({
    full:fullUrl, short:short,clicks:0, createdAt : date});
  res.send({short:short});
})

//check email registered or not
app.post("/data", async (request, response) => {
  const { email } = request.body;
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    response.send({ message: "This email is not available. Try another" });
  } else {
    response.send({ message: "This email is available" });
  }
})

//Monthly graph
app.get("/urlGraph/monthly", async (request, response) => {
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").aggregate([
    {
      "$group": {
        "_id": {
          $substr: [
            "$createdAt",
            5,
            2
          ]
        },
        "noOfUrls": {
          "$sum": 1
        }
      }
    },
    {
      "$sort": {
        "_id": 1
      }
    },
    {
      "$project": {
        date: "$_id",
        noOfUrls: 1,
        _id: 0
      }
    }
  ]).toArray();
  response.send(urlsData);
})

//daily graph
app.get("/urlGraph/daily/:month", async (request, response) => {
const {month} = request.params;
const startDate = `2021-${month}-00`
const endDate = `2021-${month}-32`
  const client = await createConnection();
  const urlsData = await client.db("urlshortener").collection("urls").aggregate([
    {
      "$match": {
        "createdAt": {
          $gt: startDate,
          $lt: endDate
        }
      }
    },
    {
      "$group": {
        "_id": {
          $substr: [
            "$createdAt",
            8,
            2
          ]
        },
        "noOfUrls": {
          "$sum": 1
        }
      }
    },
    {
      "$sort": {
        "_id": 1
      }
    },
    {
      "$project": {
        date: "$_id",
        noOfUrls: 1,
        _id: 0
      }
    }
  ]).toArray();
  response.send(urlsData);
})

//main page
app.get("/", async (request, response) => {
  response.send("Welcome to URL shortner backend APIs... Thanks-->Sridhar here");
})

//sending email for forgot password
app.post("/users/forgot", async (request, response) => {
  const { email } = request.body;
  const currentTime = new Date();
  const expireTime = new Date(currentTime.getTime() + 5 * 60000);
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    const token = jwt.sign({ email: email }, process.env.MY_SECRET_KEY);
    await client.db("urlshortener").collection("passwords").updateOne({ email: email },
      {
        $set:
          { token: token, expireTime: expireTime }
      });
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
        clientId: process.env.OAUTH_CLIENTID,
        clientSecret: process.env.OAUTH_CLIENT_SECRET,
        refreshToken: process.env.OAUTH_REFRESH_TOKEN
      }
    });
    let mailOptions = {
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Requested Password Reset Link from "URL-Shortener Web Application',
      html:
      '<a href = "https://sridharrajaram-urlshortener.netlify.app/retrieveAccount/' + email + '/' + token + '"> Reset Password Link</a>'
    };
    transporter.sendMail(mailOptions, async function (err, data) {
      if (err) {
        response.send("Error " + err);
      } else {
        response.send({ message: "Email sent successfully" });
      }
    });
  }
  else {
    response.send({ message: "This email is not registered" });
  }
})

//retrieve Account
app.get("/retrieveAccount/:email/:token", async (request, response) => {
  const currentTime = new Date();
  const { email, token } = request.params;
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    const tokenInDB = user[0].token;
    if (token == tokenInDB) {
      if (currentTime > user[0].expireTime) {
        response.send({ message: "link expired" })
      } else {
        response.send({ message: "retrieve account" });
      }

    } else {
      response.send({ message: "invalid authentication" });
    }
  }
  else {
    response.send({ message: "Invalid account" });
  }
})

//reset password
app.put("/resetPassword/:email/:token", async (request, response) => {
  const currentTime = new Date();
  const { email, token } = request.params;
  const { newPassword } = request.body;
  const client = await createConnection();
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  const user = await client.db("urlshortener").collection("passwords").find({ email: email, token: token }).toArray();
  if (!user[0]) {
    response.send({ message: "invalid url" });
  } else {
    const expireTime = user[0].expireTime;
    if (currentTime > expireTime) {
      response.send({ message: "link expired" });
    } else {
      const result = await client.db("urlshortener").collection("passwords").updateOne({
        email: email,
        token: token
      },
        {
          $set: {
            password: hashedPassword
          },
          $unset: {
            token: "",
            expireTime: ""
          }
        });
      response.send({ message: "password updated" });
    }
  }
})

//user signup api
app.post("/users/SignUp", async (request, response) => {
  const { email, password, firstName, lastName } = request.body;
  const token = jwt.sign({ email: email }, process.env.MY_SECRET_KEY);
  const url = `https://sridharrajaram-urlshortener.netlify.app/activateAccount/${email}/${token}`;
  const client = await createConnection();
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const result = await client.db("urlshortener").collection("inactive").insertOne({
    email: email, password: hashedPassword, firstName: firstName, lastName: lastName, token: token
  });

  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
      clientId: process.env.OAUTH_CLIENTID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      refreshToken: process.env.OAUTH_REFRESH_TOKEN
    }
  });

  let mailOptions = {
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Account activation link generated from "URL-Shortener Web Application"',
    html:
      `<a href =  "${url}">Click this link to activate the account </a>`
  };

  transporter.sendMail(mailOptions, async function (err, data) {
    if (err) {
      response.send("Error " + err);
    } else {
      response.send({ message: 'Activation link is sent to the mail. Please click the link to complete the registration' });
    }
  });

})

//activate account
app.put("/activateAccount/:email/:token", async (request, response) => {
    const { email, token } = request.params;
    const client = await createConnection();
    const user = await client.db("urlshortener").collection("inactive").find({ email: email, token: token }).toArray();
    if (user.length > 0) {
      await client.db("urlshortener").collection("passwords").insertOne({
        email: user[0].email, password: user[0].password, firstName: user[0].firstName, lastName: user[0].lastName
      });
      await client.db("urlshortener").collection("inactive").deleteMany({ email: email, token: token })
      response.send({ message: 'activate account' });
    } else {
      response.send({ message: 'invalid url' });
    }
  
})

//user login api
app.post("/users/Login", async (request, response) => {
  const { email, password } = request.body;
  const token = jwt.sign({ email: email }, process.env.MY_SECRET_KEY);
  const client = await createConnection();
  const user = await client.db("urlshortener").collection("passwords").find({ email: email }).toArray();
  if (user.length > 0) {
    const passwordstoredindb = user[0].password;
    const loginFormPassword = password;
    const ispasswordmatch = await bcrypt.compare(loginFormPassword, passwordstoredindb);
    if (ispasswordmatch) {
      response.send({ message: "successful login!!!", token:token });
    } else {
      response.send({ message: "invalid login" });
    }
  } else {
    response.send({ message: "invalid login" });
  }
})

//getting short id
app.get('/:short', async(req,res)=>{
  const {short} = req.params;
  const client = await createConnection();
  const url = await client.db("urlshortener").collection("urls").findOne({short: short});
  if(url == null) return res.sendStatus(404)
  let clicks = url.clicks;
  await client.db("urlshortener").collection("urls").updateOne({short: short},{$set:{clicks : clicks + 1}});
  let full = url.full
  res.send({full:full});
})

app.listen(PORT, () => console.log(`The server is running on PORT ${PORT}`));