import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, insertUserSchema, insertProjectSchema } from "@shared/schema";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import bcrypt from 'bcryptjs';

// Middleware para verificar autenticação
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.session.userId) {
    return next();
  }
  res.status(401).json({ message: "Não autorizado" });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Rota para criar um usuário administrador (uso único para configuração)
  app.post("/api/auth/setup", async (req: Request, res: Response) => {
    try {
      // Verificar se já existe um usuário admin
      const users = await storage.getUsers();
      if (users.length > 0) {
        return res.status(403).json({ message: "Setup já realizado. Não é possível criar mais usuários admin." });
      }
      
      // Validar dados do usuário
      const userData = insertUserSchema.parse(req.body);
      
      // Hash da senha
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userData.password, salt);
      
      // Criar usuário admin
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword
      });
      
      res.status(201).json({
        message: "Usuário administrador criado com sucesso",
        userId: user.id
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ 
          message: "Erro de validação", 
          errors: validationError.message 
        });
      } else {
        console.error(error);
        res.status(500).json({ 
          message: "Erro ao criar usuário administrador"
        });
      }
    }
  });

  // Rota de login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      
      // Buscar usuário pelo nome de usuário
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
      
      // Verificar senha
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }
      
      // Salvar ID do usuário na sessão
      req.session.userId = user.id;
      
      res.status(200).json({ message: "Login realizado com sucesso" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Erro ao fazer login" });
    }
  });

  // Rota para verificar autenticação
  app.get("/api/auth/check", isAuthenticated, (req: Request, res: Response) => {
    res.status(200).json({ message: "Usuário autenticado", userId: req.session.userId });
  });

  // Rota de logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Erro ao fazer logout" });
      }
      res.clearCookie("connect.sid");
      res.status(200).json({ message: "Logout realizado com sucesso" });
    });
  });

  // Contact form submission route
  app.post("/api/contact", async (req: Request, res: Response) => {
    console.log("Recebida requisição de contato:", req.body);
    try {
      // Validate request body
      const contactData = insertContactSchema.parse(req.body);
      console.log("Dados validados com sucesso:", contactData);
      
      // Store contact in database storage
      const contact = await storage.createContact(contactData);
      console.log("Contato salvo com sucesso:", contact);
      
      res.status(201).json({
        message: "Mensagem enviada com sucesso!",
        contact
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        console.error("Erro de validação:", validationError.message);
        res.status(400).json({ 
          message: "Erro de validação", 
          errors: validationError.message 
        });
      } else {
        console.error("Erro ao processar o contato:", error);
        res.status(500).json({ 
          message: "Erro ao processar seu pedido"
        });
      }
    }
  });

  // Get all contacts (for admin purposes) - protegido por autenticação
  app.get("/api/contacts", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const contacts = await storage.getContacts();
      res.status(200).json(contacts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ 
        message: "Erro ao buscar mensagens de contato"
      });
    }
  });

  // ----------- Rotas de Projetos -----------

  // Get all projects
  app.get("/api/projects", async (_req: Request, res: Response) => {
    try {
      const projects = await storage.getProjects();
      res.status(200).json(projects);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Erro ao buscar projetos" });
    }
  });

  // Get project by slug
  app.get("/api/projects/:slug", async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const project = await storage.getProjectBySlug(slug);
      
      if (!project) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      
      res.status(200).json(project);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Erro ao buscar projeto" });
    }
  });

  // Create project (protegido por autenticação)
  app.post("/api/projects", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const projectData = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(projectData);
      
      res.status(201).json({
        message: "Projeto criado com sucesso",
        project
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ 
          message: "Erro de validação", 
          errors: validationError.message 
        });
      } else {
        console.error(error);
        res.status(500).json({ message: "Erro ao criar projeto" });
      }
    }
  });

  // Update project (protegido por autenticação)
  app.patch("/api/projects/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const projectId = parseInt(id);
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "ID de projeto inválido" });
      }
      
      const existingProject = await storage.getProjectById(projectId);
      if (!existingProject) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      
      // Validar apenas os campos fornecidos para atualização
      const projectUpdate = req.body;
      
      const updatedProject = await storage.updateProject(projectId, projectUpdate);
      
      res.status(200).json({
        message: "Projeto atualizado com sucesso",
        project: updatedProject
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Erro ao atualizar projeto" });
    }
  });

  // Delete project (protegido por autenticação)
  app.delete("/api/projects/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const projectId = parseInt(id);
      
      if (isNaN(projectId)) {
        return res.status(400).json({ message: "ID de projeto inválido" });
      }
      
      const success = await storage.deleteProject(projectId);
      
      if (!success) {
        return res.status(404).json({ message: "Projeto não encontrado" });
      }
      
      res.status(200).json({ message: "Projeto excluído com sucesso" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Erro ao excluir projeto" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
