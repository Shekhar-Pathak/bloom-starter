import express from "express";
import * as bodyParser from "body-parser";
import helmet from "helmet";
import compress from "compression";
import session from "express-session";
import uuid from "uuid";
import path from "path";
import http from "http";
import morgan from "morgan";
import { IVerifiedData } from "@bloomprotocol/share-kit/dist/src/types";

import { loggedInSession } from "./middleware";
import { applySocket, sendSocketMessage } from "./socket";
import { env } from "./environment";

const sessionParser = session({
  saveUninitialized: false,
  secret: env.sessionSecret,
  resave: false
});

const app = express();

app.use(helmet());
app.use(morgan("tiny"));

app.use(sessionParser);

app.use(
  bodyParser.json({
    type: "*/*",
    verify: (req, _, buf) => {
      (req as any).rawBody = buf;
      return true;
    },
    limit: "10mb" // https://stackoverflow.com/a/19965089/1165441
  })
);

app.use(compress());

app.use(express.static(path.join(__dirname, "build/client")));

app.post("/session", (req, res) => {
  if (req.session!.userId === undefined) {
    const id = uuid.v4();
    req.session!.userId = id;
  }

  res.send({
    success: true,
    message: "Session updated",
    token: req.session!.userId
  });
});

app.delete("/clear-session", loggedInSession, (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        res.status(500).send({
          success: false,
          message: "Something went wrong while destroying session"
        });
      } else {
        res.send({ success: true, message: "Session destroyed" });
      }
    });
  }
});

app.post("/scan", async (req, res) => {
  try {
    const attestations: IVerifiedData[] = req.body.data;
    const nameAttestation = attestations.find(
      attestation =>
        attestation.target.attestationNode.type.type === "full-name"
    );

    const name =
      nameAttestation && nameAttestation.target.attestationNode.data.data;

    if (!name) {
      throw new Error("Missing Name");
    }

    await sendSocketMessage({
      userId: req.body.token,
      type: "share-kit-scan",
      payload: JSON.stringify({ name })
    });

    res.status(200).json({ success: true, message: "Message Sent" });
  } catch (err) {
    if (err.message === "Missing Name") {
      res.status(404).send({
        success: false,
        message: "Full name is missing from completed attestations"
      });
    } else {
      res.status(500).send({
        success: false,
        message: "Something went wrong while sending message"
      });
    }
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "build/client", "index.html"));
});

const server = http.createServer(app);

applySocket(server, sessionParser);

server.listen(env.port, () =>
  console.log(`Listening on http://localhost:${env.port}`)
);
