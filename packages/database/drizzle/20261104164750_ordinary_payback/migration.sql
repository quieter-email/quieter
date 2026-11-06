-- quieter:contract
CREATE UNIQUE INDEX "mailbox_agent_run_received_actor_message_unique" ON "mailboxAgentRun" ("mailboxId","actorUserId","messageId") WHERE "triggerKind" = 'mail_received';