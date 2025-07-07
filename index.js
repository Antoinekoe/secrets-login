import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10; // Bcrypt salt rounds
env.config();

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.set("view engine", "ejs");

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // Serve static files

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Database connection
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

// Home page route
app.get("/", (req, res) => {
  res.render("home");
});

// Google OAuth routes
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/secrets",
  passport.authenticate("google", {
    successRedirect: "/secrets",
    failureRedirect: "/login",
  })
);

app.get("/submit", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("submit");
  } else {
    res.redirect("/login");
  }
});

app.post("/submit", async (req, res) => {
  try {
    const secret = req.body.secret;
    const userID = req.user.id;
    const result = await db.query(
      "UPDATE users SET secret = $1 WHERE id = $2 RETURNING *",
      [secret, userID]
    );
    res.render("secrets", {
      secret: result.rows[0].secret,
    });
  } catch (err) {
    console.log("Failed to update secret", err);
  }
});

// Login page route
app.get("/login", (req, res) => {
  res.render("login");
});

// Register page route
app.get("/register", (req, res) => {
  res.render("register");
});

// Logout route
app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

// Protected route
app.get("/secrets", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("secrets", {
      secret: req.user.secret,
    });
  } else {
    res.redirect("/login");
  }
});

// Authentication routes
app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/secrets",
    failureRedirect: "/login",
  })
);

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    // Check if user exists
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    // If user exists, redirect to login page
    if (checkResult.rows.length > 0) {
      req.redirect("/login");
    } else {
      // Hash password and create user
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            res.redirect("/secrets");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

// Local authentication strategy
passport.use(
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

// Google OAuth strategy
passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/secrets",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      // Check if user exists
      const result = await db.query("SELECT * FROM users WHERE email=$1", [
        profile.email,
      ]);
      if (result.rows.length === 0) {
        // Create new user with OAuth
        const newUser = await db.query(
          "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
          [profile.email, "google"]
        );
        cb(null, newUser.rows[0]);
      } else {
        // If user exists, return user
        cb(null, result.rows[0]);
      }
    }
  )
);

// Session serialization
passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
