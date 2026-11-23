const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "development-secret";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

// ============================================================
// FILE UPLOAD
// ============================================================

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const filename =
            Date.now() +
            "-" +
            file.originalname;

        cb(null, filename);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

// ============================================================
// IN-MEMORY CACHE
// ============================================================

const productCache = {};
const userCache = {};

function setCache(cache, key, value, ttl = 60000) {
    cache[key] = {
        value,
        expires: Date.now() + ttl
    };
}

function getCache(cache, key) {
    if (!cache[key]) return null;

    if (cache[key].expires < Date.now()) {
        return cache[key].value;
    }

    return cache[key].value;
}

function deleteCache(cache, key) {
    delete cache[key];
}

// ============================================================
// DATABASE HELPERS
// ============================================================

async function query(text, params = []) {
    const client = await pool.connect();

    try {
        const result = await client.query(text, params);
        return result.rows;
    } finally {
        client.release();
    }
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

async function authenticate(req, res, next) {
    try {
        const token = req.headers.authorization;

        if (!token) {
            return res.status(401).json({
                message: "Authentication required"
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        req.user = decoded;

        next();
    } catch (error) {
        console.error(error);

        res.status(401).json({
            message: "Invalid authentication"
        });
    }
}

// ============================================================
// ADMIN MIDDLEWARE
// ============================================================

function adminOnly(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            message: "Login required"
        });
    }

    if (req.user.role !== "admin") {
        return res.status(403).json({
            message: "Admin access required"
        });
    }

    next();
}

// ============================================================
// HEALTH
// ============================================================

app.get("/health", async (req, res) => {
    try {
        const result = await query("SELECT NOW()");

        res.json({
            status: "ok",
            database: result[0],
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: error.message
        });
    }
});

// ============================================================
// REGISTER
// ============================================================

app.post("/api/auth/register", async (req, res) => {
    try {
        const {
            name,
            email,
            password
        } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "All fields are required"
            });
        }

        const existingUser = await query(
            "SELECT id FROM users WHERE email = $1",
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({
                message: "Email already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(
            password,
            10
        );

        const rows = await query(
            `
            INSERT INTO users
            (name, email, password, role)
            VALUES ($1, $2, $3, 'user')
            RETURNING id, name, email, role
            `,
            [name, email, password]
        );

        res.status(201).json({
            user: rows[0]
        });

    } catch (error) {
        console.error("REGISTER ERROR:", error);

        res.status(500).json({
            message: "Registration failed"
        });
    }
});

// ============================================================
// LOGIN
// ============================================================

app.post("/api/auth/login", async (req, res) => {
    try {
        const {
            email,
            password
        } = req.body;

        const rows = await query(
            `
            SELECT id, name, email, password, role
            FROM users
            WHERE email = $1
            `,
            [email]
        );

        if (!rows.length) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const user = rows[0];

        const validPassword =
            bcrypt.compare(
                password,
                user.password
            );

        if (!validPassword) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role
            },
            JWT_SECRET,
            {
                expiresIn: "7d"
            }
        );

        delete user.password;

        res.json({
            message: "Login successful",
            token,
            user
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        res.status(500).json({
            message: "Login failed"
        });
    }
});

// ============================================================
// CURRENT USER
// ============================================================

app.get("/api/me", authenticate, async (req, res) => {
    try {
        const cacheKey = `user:${req.user.id}`;

        let user = getCache(userCache, cacheKey);

        if (!user) {
            const rows = await query(
                `
                SELECT id, name, email, role
                FROM users
                WHERE id = $1
                `,
                [req.user.id]
            );

            if (!rows.length) {
                return res.status(404).json({
                    message: "User not found"
                });
            }

            user = rows[0];

            setCache(
                userCache,
                cacheKey,
                user
            );
        }

        res.json({
            user
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Failed to load user"
        });
    }
});

// ============================================================
// PRODUCTS - LIST
// ============================================================

app.get("/api/products", async (req, res) => {
    try {
        let {
            page = 1,
            limit = 10,
            search,
            category,
            minPrice,
            maxPrice
        } = req.query;

        page = Number(page);
        limit = Number(limit);

        const offset = (page - 1) * limit;

        let sql = `
            SELECT
                p.id,
                p.name,
                p.description,
                p.price,
                p.stock,
                p.category_id,
                c.name AS category
            FROM products p
            LEFT JOIN categories c
                ON p.category_id = c.id
            WHERE 1 = 1
        `;

        const params = [];

        if (search) {
            params.push(`%${search}%`);
            sql += ` AND p.name ILIKE $${params.length}`;
        }

        if (category) {
            params.push(category);
            sql += ` AND c.name = $${params.length}`;
        }

        if (minPrice) {
            params.push(Number(minPrice));
            sql += ` AND p.price >= $${params.length}`;
        }

        if (maxPrice) {
            params.push(Number(maxPrice));
            sql += ` AND p.price <= $${params.length}`;
        }

        sql += `
            ORDER BY p.created_at DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const products = await query(sql, params);

        res.json({
            page,
            limit,
            count: products.length,
            products
        });

    } catch (error) {
        console.error("PRODUCT LIST ERROR:", error);

        res.status(500).json({
            message: "Failed to load products"
        });
    }
});

// ============================================================
// SINGLE PRODUCT
// ============================================================

app.get("/api/products/:id", async (req, res) => {
    try {
        const id = req.params.id;

        const cached =
            getCache(productCache, id);

        if (cached) {
            return res.json({
                product: cached,
                source: "cache"
            });
        }

        const rows = await query(
            `
            SELECT
                p.*,
                c.name AS category
            FROM products p
            LEFT JOIN categories c
                ON c.id = p.category_id
            WHERE p.id = $1
            `,
            [id]
        );

        if (!rows.length) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        setCache(
            productCache,
            id,
            rows[0]
        );

        res.json({
            product: rows[0],
            source: "database"
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Failed to load product"
        });
    }
});

// ============================================================
// CREATE PRODUCT
// ============================================================

app.post(
    "/api/products",
    authenticate,
    adminOnly,
    async (req, res) => {
        try {
            const {
                name,
                description,
                price,
                stock,
                categoryId
            } = req.body;

            if (!name || !price) {
                return res.status(400).json({
                    message: "Name and price are required"
                });
            }

            const rows = await query(
                `
                INSERT INTO products
                (
                    name,
                    description,
                    price,
                    stock,
                    category_id
                )
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
                `,
                [
                    name,
                    description,
                    price,
                    stock || 0,
                    categoryId
                ]
            );

            res.status(201).json({
                product: rows[0]
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Product creation failed"
            });
        }
    }
);

// ============================================================
// UPDATE PRODUCT
// ============================================================

app.put(
    "/api/products/:id",
    authenticate,
    adminOnly,
    async (req, res) => {
        try {
            const {
                name,
                description,
                price,
                stock
            } = req.body;

            const id = req.params.id;

            const rows = await query(
                `
                UPDATE products
                SET
                    name = $1,
                    description = $2,
                    price = $3,
                    stock = $4
                WHERE id = $5
                RETURNING *
                `,
                [
                    name,
                    description,
                    price,
                    stock,
                    id
                ]
            );

            if (!rows.length) {
                return res.status(404).json({
                    message: "Product not found"
                });
            }

            res.json({
                product: rows[0]
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Update failed"
            });
        }
    }
);

// ============================================================
// DELETE PRODUCT
// ============================================================

app.delete(
    "/api/products/:id",
    authenticate,
    adminOnly,
    async (req, res) => {
        try {
            const id = req.params.id;

            await query(
                "DELETE FROM products WHERE id = $1",
                [id]
            );

            deleteCache(productCache, id);

            res.json({
                message: "Product deleted"
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Delete failed"
            });
        }
    }
);

// ============================================================
// CART
// ============================================================

app.get(
    "/api/cart",
    authenticate,
    async (req, res) => {
        try {
            const rows = await query(
                `
                SELECT
                    ci.id,
                    ci.quantity,
                    p.id AS product_id,
                    p.name,
                    p.price
                FROM cart_items ci
                JOIN products p
                    ON p.id = ci.product_id
                WHERE ci.user_id = $1
                `,
                [req.user.id]
            );

            const total = rows.reduce(
                (sum, item) =>
                    sum + item.price * item.quantity,
                0
            );

            res.json({
                items: rows,
                total
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Could not load cart"
            });
        }
    }
);

// ============================================================
// ADD TO CART
// ============================================================

app.post(
    "/api/cart",
    authenticate,
    async (req, res) => {
        try {
            const {
                productId,
                quantity
            } = req.body;

            const product = await query(
                `
                SELECT id, stock
                FROM products
                WHERE id = $1
                `,
                [productId]
            );

            if (!product.length) {
                return res.status(404).json({
                    message: "Product not found"
                });
            }

            if (product[0].stock < quantity) {
                return res.status(400).json({
                    message: "Not enough stock"
                });
            }

            await query(
                `
                INSERT INTO cart_items
                (
                    user_id,
                    product_id,
                    quantity
                )
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id, product_id)
                DO UPDATE SET
                    quantity =
                        cart_items.quantity + EXCLUDED.quantity
                `,
                [
                    req.user.id,
                    productId,
                    quantity
                ]
            );

            res.status(201).json({
                message: "Added to cart"
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Could not add item"
            });
        }
    }
);

// ============================================================
// CREATE ORDER
// ============================================================

app.post(
    "/api/orders",
    authenticate,
    async (req, res) => {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const cart = await client.query(
                `
                SELECT
                    ci.product_id,
                    ci.quantity,
                    p.price,
                    p.stock
                FROM cart_items ci
                JOIN products p
                    ON p.id = ci.product_id
                WHERE ci.user_id = $1
                `,
                [req.user.id]
            );

            if (!cart.rows.length) {
                await client.query("ROLLBACK");

                return res.status(400).json({
                    message: "Cart is empty"
                });
            }

            let total = 0;

            for (const item of cart.rows) {
                if (item.stock < item.quantity) {
                    throw new Error(
                        `Insufficient stock for product ${item.product_id}`
                    );
                }

                total +=
                    Number(item.price) *
                    Number(item.quantity);
            }

            const orderResult = await client.query(
                `
                INSERT INTO orders
                (
                    user_id,
                    total,
                    status
                )
                VALUES ($1, $2, 'pending')
                RETURNING id
                `,
                [req.user.id, total]
            );

            const orderId =
                orderResult.rows[0].id;

            for (const item of cart.rows) {
                await client.query(
                    `
                    INSERT INTO order_items
                    (
                        order_id,
                        product_id,
                        quantity,
                        price
                    )
                    VALUES ($1, $2, $3, $4)
                    `,
                    [
                        orderId,
                        item.product_id,
                        item.quantity,
                        item.price
                    ]
                );

                await client.query(
                    `
                    UPDATE products
                    SET stock = stock - $1
                    WHERE id = $2
                    `,
                    [
                        item.quantity,
                        item.product_id
                    ]
                );
            }

            await client.query(
                `
                DELETE FROM cart_items
                WHERE user_id = $1
                `,
                [req.user.id]
            );

            await client.query("COMMIT");

            res.status(201).json({
                message: "Order created",
                orderId,
                total
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error(
                "ORDER ERROR:",
                error
            );

            res.status(500).json({
                message: error.message
            });

        } finally {
            client.release();
        }
    }
);

// ============================================================
// ORDER HISTORY
// ============================================================

app.get(
    "/api/orders",
    authenticate,
    async (req, res) => {
        try {
            const rows = await query(
                `
                SELECT
                    o.id,
                    o.total,
                    o.status,
                    o.created_at,
                    COUNT(oi.id) AS item_count
                FROM orders o
                LEFT JOIN order_items oi
                    ON oi.order_id = o.id
                WHERE o.user_id = $1
                `,
                [req.user.id]
            );

            res.json({
                orders: rows
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Failed to load orders"
            });
        }
    }
);

// ============================================================
// ADMIN DASHBOARD
// ============================================================

app.get(
    "/api/admin/dashboard",
    authenticate,
    adminOnly,
    async (req, res) => {
        try {
            const users = await query(
                "SELECT COUNT(*) AS count FROM users"
            );

            const products = await query(
                "SELECT COUNT(*) AS count FROM products"
            );

            const orders = await query(
                "SELECT COUNT(*) AS count FROM orders"
            );

            const revenue = await query(
                `
                SELECT SUM(total) AS revenue
                FROM orders
                WHERE status = 'completed'
                `
            );

            res.json({
                users: Number(users[0].count),
                products: Number(products[0].count),
                orders: Number(orders[0].count),
                revenue: Number(
                    revenue[0].revenue || 0
                )
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Dashboard failed"
            });
        }
    }
);

// ============================================================
// PROFILE IMAGE
// ============================================================

app.post(
    "/api/profile/image",
    authenticate,
    upload.single("image"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    message: "Image required"
                });
            }

            const imageUrl =
                `/uploads/${req.file.filename}`;

            await query(
                `
                UPDATE users
                SET profile_image = $1
                WHERE id = $2
                `,
                [
                    imageUrl,
                    req.body.userId
                ]
            );

            deleteCache(
                userCache,
                `user:${req.user.id}`
            );

            res.json({
                message: "Profile image uploaded",
                url: imageUrl
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                message: "Upload failed"
            });
        }
    }
);

// ============================================================
// PUBLIC FILES
// ============================================================

app.use(
    "/uploads",
    express.static(uploadDir)
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
    console.error("GLOBAL ERROR:", err);

    res.status(500).json({
        message: "Something went wrong",
        error: err.message,
        stack: err.stack
    });
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
    res.status(404).json({
        message: "Route not found",
        path: req.originalUrl
    });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log(
        `Server running on http://localhost:${PORT}`
    );
});